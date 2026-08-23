/**
 * ecommerceOrderService.js
 * 
 * Servicio principal para procesar pedidos que llegan por email de e-commerce
 * a través de Chatwoot. Detecta, parsea, deduplicada y crea pedidos.
 */

const pedidosRepo = require('../../repositories/pedidosRepository');
const configuracionRepo = require('../../repositories/configuracionRepository');
const chatwootService = require('../chatwoot/chatwootService');
const emailService = require('../email/emailService');
const emailParser = require('./ecommerceEmailParser');
const stateMachine = require('../pedidos/orderStateMachine');

module.exports = {
  /**
   * Quick check if content looks like an order email.
   * Used by webhookService to decide whether to route here.
   */
  looksLikeOrderEmail(content) {
    return emailParser.looksLikeOrderEmail(content);
  },

  /**
   * Process an email that has been identified as an e-commerce order.
   * 
   * @param {Object} params
   * @param {string} params.content - Email body text from Chatwoot
   * @param {string} params.conversationId - Chatwoot conversation ID
   * @param {string} params.accountId - Chatwoot account ID
   * @param {Object} params.sender - Sender info from Chatwoot payload
   * @param {string} params.messageId - Chatwoot message ID (for logging)
   */
  async processOrderEmail({ content, conversationId, accountId, sender, messageId }) {
    console.log(`[EcommerceOrder] Processing order email from conv #${conversationId}`);

    // 1. Parse the email content
    const parsed = emailParser.parseOrderEmail(content);
    if (!parsed || !parsed.orderNumber) {
      console.warn(`[EcommerceOrder] Could not parse order number from email in conv #${conversationId}`);
      // Still create a pedido with raw content so nothing is lost
      return await this._createUnparsedOrder({ content, conversationId, accountId, sender });
    }

    console.log(`[EcommerceOrder] Parsed order: ${parsed.orderNumber}, payment: ${parsed.paymentStatus}`);

    // 2. Deduplication: check if this order number already exists
    const existing = await pedidosRepo.getByEcommerceOrderNumber(parsed.orderNumber);
    if (existing) {
      console.log(`[EcommerceOrder] Order ${parsed.orderNumber} already exists as pedido #${existing.id}, skipping`);
      return { action: 'duplicate_skipped', orderId: existing.id, orderNumber: parsed.orderNumber };
    }

    // 3. Build customer and items data
    const cliente = {
      nombre: parsed.customer.name || sender.name || 'No especificado',
      email: parsed.customer.email || sender.email || null,
      telefono: parsed.customer.phone || sender.phone_number || null,
      direccion: parsed.customer.address || null,
      metodo_envio: parsed.shippingMethod || null,
    };

    const items = parsed.items.length > 0
      ? parsed.items
      : [{ name: 'Ver detalle en email original', quantity: 1, price: parsed.total || 0 }];

    // 4. Determine initial state based on payment
    const autoConfirm = await configuracionRepo.get('ecommerce_auto_confirm_paid');
    const isPaid = parsed.paymentStatus === 'paid';
    const shouldAutoConfirm = isPaid && autoConfirm !== 'false';

    const initialEstado = shouldAutoConfirm ? 'confirmado' : 'pendiente';
    const pagoEstado = isPaid ? 'pagado' : 'pendiente_pago';

    // 5. Create the order in DB
    const pedido = await pedidosRepo.create({
      conversation_id: conversationId,
      account_id: accountId,
      cliente,
      items,
      origen: 'ecommerce',
      pago_estado: pagoEstado,
      pago_referencia: parsed.paymentMethod || null,
      ecommerce_order_number: parsed.orderNumber,
      estado_inicial: initialEstado,
    });

    console.log(`[EcommerceOrder] Created pedido #${pedido.id} (estado: ${initialEstado}, pago: ${pagoEstado})`);

    // 6. Send notifications based on state
    if (shouldAutoConfirm) {
      // Order is paid → alert depot for preparation
      await this._notifyPreparation(pedido, accountId, conversationId);
      return { action: 'auto_confirmed', orderId: pedido.id, orderNumber: parsed.orderNumber };
    } else {
      // Order is pending → notify ecommerce team
      await this._notifyPendingOrder(pedido, accountId, conversationId);
      return { action: 'pending_created', orderId: pedido.id, orderNumber: parsed.orderNumber };
    }
  },

  /**
   * Create an order from an email we couldn't fully parse.
   * Stores raw content so staff can review manually.
   */
  async _createUnparsedOrder({ content, conversationId, accountId, sender }) {
    const cliente = {
      nombre: sender.name || 'No especificado',
      email: sender.email || null,
      telefono: sender.phone_number || null,
      nota: 'Pedido recibido por email - requiere revisión manual',
    };

    const items = [{
      name: 'Pedido sin parsear - ver conversación en Chatwoot',
      quantity: 1,
      price: 0,
      rawContent: content.substring(0, 2000), // Cap at 2000 chars
    }];

    const pedido = await pedidosRepo.create({
      conversation_id: conversationId,
      account_id: accountId,
      cliente,
      items,
      origen: 'ecommerce',
      pago_estado: 'sin_pago',
      pago_referencia: null,
      ecommerce_order_number: null,
    });

    console.warn(`[EcommerceOrder] Created unparsed order #${pedido.id} for manual review`);

    // Notify team that manual review is needed
    try {
      await emailService.sendNewOrderAlert(pedido);
    } catch (err) {
      console.warn(`[EcommerceOrder] Alert email failed: ${err.message}`);
    }

    return { action: 'unparsed_created', orderId: pedido.id };
  },

  /**
   * Notify depot that a paid order is ready for preparation.
   */
  async _notifyPreparation(pedido, accountId, conversationId) {
    // Send preparation alert email to depot
    try {
      await emailService.sendPreparationAlert(pedido);
    } catch (err) {
      console.warn(`[EcommerceOrder] Preparation alert email failed: ${err.message}`);
    }

    // Send Chatwoot message confirming the order was received and is being prepared
    try {
      const msg =
        (await configuracionRepo.get('msg_ecommerce_confirmado')) ||
        `✅ Pedido ${pedido.ecommerce_order_number || '#' + pedido.id} recibido y confirmado. Pago acreditado. El pedido pasa a preparación.`;
      await chatwootService.sendMessage(accountId, conversationId, msg);
    } catch (err) {
      console.warn(`[EcommerceOrder] Chatwoot confirmation message failed: ${err.message}`);
    }
  },

  /**
   * Notify ecommerce team that a new order is pending review/payment.
   */
  async _notifyPendingOrder(pedido, accountId, conversationId) {
    // Send alert email
    try {
      await emailService.sendNewOrderAlert(pedido);
    } catch (err) {
      console.warn(`[EcommerceOrder] New order alert email failed: ${err.message}`);
    }

    // Send Chatwoot message acknowledging the order
    try {
      const msg =
        (await configuracionRepo.get('msg_ecommerce_pendiente')) ||
        `📋 Pedido ${pedido.ecommerce_order_number || '#' + pedido.id} recibido. Estamos verificando el pago. Te avisamos cuando esté confirmado.`;
      await chatwootService.sendMessage(accountId, conversationId, msg);
    } catch (err) {
      console.warn(`[EcommerceOrder] Chatwoot pending message failed: ${err.message}`);
    }
  },
};
