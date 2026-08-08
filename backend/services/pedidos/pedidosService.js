const pedidosRepo = require('../../repositories/pedidosRepository');
const configuracionRepo = require('../../repositories/configuracionRepository');
const chatwootService = require('../chatwoot/chatwootService');
const emailService = require('../email/emailService');
const stateMachine = require('./orderStateMachine');

module.exports = {
  async createOrder({ conversation_id, account_id, cliente, items }) {
    console.log(`[PedidosService] Creating pending order for conv #${conversation_id}...`);
    const pedido = await pedidosRepo.create({
      conversation_id,
      account_id,
      cliente,
      items,
    });

    // Send fixed message msg_pedido_pendiente to client via Chatwoot
    const msgPendiente =
      (await configuracionRepo.get('msg_pedido_pendiente')) ||
      'Tu pedido pasó a revisión humana, en breve te confirmamos.';
    
    await chatwootService.sendMessage(account_id, conversation_id, msgPendiente);

    // Notify internal team via email
    try {
      await emailService.sendNewOrderAlert(pedido);
    } catch (err) {
      console.warn(`[Order Alert Email Error] ${err.message}`);
    }

    return pedido;
  },

  async updateOrderStatus(id, targetState, cambiadoPor = 'admin') {
    const pedidoActual = await pedidosRepo.getById(id);
    if (!pedidoActual) {
      throw new Error(`Pedido #${id} no encontrado`);
    }

    // Validate state machine transition
    stateMachine.assertTransition(pedidoActual.estado, targetState);

    // Perform database transaction + audit log
    const { pedido } = await pedidosRepo.updateEstado(id, targetState, cambiadoPor);

    // Dispatch fixed message depending on targetState
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
    }

    return pedido;
  },

  async handleCustomerCancellation(conversationId, accountId) {
    const activeOrder = await pedidosRepo.getActiveByConversation(conversationId);
    if (activeOrder && activeOrder.estado === 'pendiente') {
      console.log(`[PedidosService] Customer requested cancellation of order #${activeOrder.id}`);
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
      console.warn(`[Pedidos Alert Job] Found ${pendingOrders.length} pending orders older than ${hours} hours!`);
    }
    return pendingOrders;
  },
};
