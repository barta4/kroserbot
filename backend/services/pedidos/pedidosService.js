const pedidosRepo = require('../../repositories/pedidosRepository');
const configuracionRepo = require('../../repositories/configuracionRepository');
const chatwootService = require('../chatwoot/chatwootService');
const emailService = require('../email/emailService');
const stateMachine = require('./orderStateMachine');
const logger = require('../../config/logger');

module.exports = {
  async createOrder({ conversation_id, account_id, cliente, items }) {
    logger.info('Creating pending order', { conversationId: conversation_id });
    const pedido = await pedidosRepo.create({
      conversation_id,
      account_id,
      cliente,
      items,
    });

    const msgPendiente =
      (await configuracionRepo.get('msg_pedido_pendiente')) ||
      'Tu pedido pasó a revisión humana, en breve te confirmamos.';

    await chatwootService.sendMessage(account_id, conversation_id, msgPendiente);

    try {
      await emailService.sendNewOrderAlert(pedido);
    } catch (err) {
      logger.warn('Order alert email failed', { pedidoId: pedido.id, error: err.message });
    }

    return pedido;
  },

  async createEcommerceOrder({ conversation_id, account_id, cliente, items, pago_estado, pago_referencia, ecommerce_order_number, auto_confirm }) {
    logger.info('Creating ecommerce order', { conversationId: conversation_id, orderNumber: ecommerce_order_number });

    const isPaid = pago_estado === 'pagado';
    const shouldAutoConfirm = isPaid && auto_confirm !== false;
    const estadoInicial = shouldAutoConfirm ? 'confirmado' : 'pendiente';

    const pedido = await pedidosRepo.create({
      conversation_id,
      account_id,
      cliente,
      items,
      origen: 'ecommerce',
      pago_estado: pago_estado || 'sin_pago',
      pago_referencia: pago_referencia || null,
      ecommerce_order_number: ecommerce_order_number || null,
      estado_inicial: estadoInicial,
    });

    logger.info('Ecommerce order created', { pedidoId: pedido.id, estado: estadoInicial, pago: pago_estado });

    if (shouldAutoConfirm) {
      await this.sendPreparationAlert(pedido);
    } else {
      try {
        await emailService.sendNewOrderAlert(pedido);
      } catch (err) {
        logger.warn('Ecommerce order alert email failed', { pedidoId: pedido.id, error: err.message });
      }
    }

    return pedido;
  },

  async sendPreparationAlert(pedido) {
    logger.info('Sending preparation alert', { pedidoId: pedido.id });

    try {
      await emailService.sendPreparationAlert(pedido);
    } catch (err) {
      logger.warn('Preparation alert email failed', { pedidoId: pedido.id, error: err.message });
    }

    if (pedido.conversation_id && pedido.account_id) {
      try {
        const msg =
          (await configuracionRepo.get('msg_pedido_en_preparacion')) ||
          `📦 Pedido ${pedido.ecommerce_order_number || '#' + pedido.id} pago confirmado. Pasó a preparación.`;
        await chatwootService.sendMessage(pedido.account_id, pedido.conversation_id, msg);
      } catch (err) {
        logger.warn('Preparation Chatwoot message failed', { pedidoId: pedido.id, error: err.message });
      }
    }
  },

  async updateOrderStatus(id, targetState, cambiadoPor = 'admin') {
    const pedidoActual = await pedidosRepo.getById(id);
    if (!pedidoActual) {
      throw new Error(`Pedido #${id} no encontrado`);
    }

    stateMachine.assertTransition(pedidoActual.estado, targetState);

    const { pedido } = await pedidosRepo.updateEstado(id, targetState, cambiadoPor);

    logger.info('Order status updated', { pedidoId: id, from: pedidoActual.estado, to: targetState, by: cambiadoPor });

    if (targetState === 'confirmado') {
      const msgListo =
        (await configuracionRepo.get('msg_pedido_listo')) ||
        '¡Tu pedido fue confirmado! Te contactamos para coordinar la entrega.';
      await chatwootService.sendMessage(pedido.account_id, pedido.conversation_id, msgListo);
    } else if (targetState === 'rechazado') {
      const msgRechazado =
        (await configuracionRepo.get('msg_pedido_rechazado')) ||
        'Lamentamos informarte que no pudimos procesar tu pedido. Un asesor te contactará.';
      await chatwootService.sendMessage(pedido.account_id, pedido.conversation_id, msgRechazado);
    } else if (targetState === 'en_preparacion') {
      await this.sendPreparationAlert(pedido);
    }

    return pedido;
  },

  async handleCustomerCancellation(conversationId, accountId) {
    const activeOrder = await pedidosRepo.getActiveByConversation(conversationId);
    if (activeOrder && activeOrder.estado === 'pendiente') {
      logger.info('Customer requested cancellation', { pedidoId: activeOrder.id, conversationId });
      await this.updateOrderStatus(activeOrder.id, 'cancelado', 'cliente');
      await chatwootService.sendMessage(
        accountId,
        conversationId,
        'Tu pedido ha sido cancelado exitosamente.'
      );
      return true;
    }
    return false;
  },

  async checkPendingOrdersJob(hours = 2) {
    const pendingOrders = await pedidosRepo.getPendingOlderThanHours(hours);
    if (pendingOrders.length > 0) {
      logger.warn('Pending orders alert', { count: pendingOrders.length, olderThanHours: hours });
    }
    return pendingOrders;
  },
};
