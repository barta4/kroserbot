/**
 * mercadopagoService.js
 * 
 * Integración con MercadoPago. Todas las funciones verifican que el toggle
 * 'mercadopago_enabled' esté activo antes de ejecutar.
 * 
 * Por ahora preparado para futuro uso - se activa/desactiva desde el panel admin.
 */

const configuracionRepo = require('../../repositories/configuracionRepository');
const pedidosRepo = require('../../repositories/pedidosRepository');

let MercadoPago = null;
try {
  MercadoPago = require('mercadopago');
} catch (_err) {
  MercadoPago = null;
}

/**
 * Check if MercadoPago integration is enabled.
 */
async function isEnabled() {
  const enabled = await configuracionRepo.get('mercadopago_enabled');
  return enabled === 'true';
}

/**
 * Get a configured MercadoPago client.
 * Returns null if disabled or not configured.
 */
async function getClient() {
  if (!MercadoPago) {
    console.warn('[MercadoPago] SDK not installed. Run: npm install mercadopago');
    return null;
  }

  const enabled = await isEnabled();
  if (!enabled) {
    return null;
  }

  const accessToken =
    (await configuracionRepo.get('mercadopago_access_token')) ||
    process.env.MERCADOPAGO_ACCESS_TOKEN;

  if (!accessToken) {
    console.warn('[MercadoPago] No access token configured');
    return null;
  }

  const client = new MercadoPago.MercadoPagoConfig({ accessToken });
  return client;
}

module.exports = {
  /**
   * Check if MercadoPago is enabled.
   */
  async isEnabled() {
    return await isEnabled();
  },

  /**
   * Toggle MercadoPago on or off.
   */
  async toggle(enable) {
    const value = enable ? 'true' : 'false';
    await configuracionRepo.set('mercadopago_enabled', value);
    console.log(`[MercadoPago] Integration ${enable ? 'ENABLED' : 'DISABLED'}`);
    return { enabled: enable };
  },

  /**
   * Create a payment preference (link de pago) for a pedido.
   * Returns the preference with init_point (payment URL).
   */
  async createPreference(pedidoId) {
    const enabled = await isEnabled();
    if (!enabled) {
      return { enabled: false, message: 'MercadoPago está desactivado' };
    }

    const client = await getClient();
    if (!client) {
      return { enabled: false, message: 'MercadoPago no está configurado correctamente' };
    }

    const pedido = await pedidosRepo.getById(pedidoId);
    if (!pedido) {
      throw new Error(`Pedido #${pedidoId} no encontrado`);
    }

    const items = (typeof pedido.items === 'string' ? JSON.parse(pedido.items) : pedido.items) || [];
    const cliente = (typeof pedido.cliente === 'string' ? JSON.parse(pedido.cliente) : pedido.cliente) || {};

    try {
      const preference = new MercadoPago.Preference(client);
      const result = await preference.create({
        body: {
          items: items.map((item) => ({
            title: item.name || item.nombre || 'Producto Kroser',
            quantity: item.quantity || item.cantidad || 1,
            unit_price: parseFloat(item.price || item.precio || 0),
            currency_id: 'UYU',
          })),
          payer: {
            name: cliente.nombre || '',
            email: cliente.email || '',
            phone: { number: cliente.telefono || '' },
          },
          external_reference: `pedido_${pedidoId}`,
          notification_url: process.env.MERCADOPAGO_WEBHOOK_URL || '',
          back_urls: {
            success: process.env.MERCADOPAGO_SUCCESS_URL || '',
            failure: process.env.MERCADOPAGO_FAILURE_URL || '',
            pending: process.env.MERCADOPAGO_PENDING_URL || '',
          },
          auto_return: 'approved',
        },
      });

      console.log(`[MercadoPago] Preference created for pedido #${pedidoId}: ${result.id}`);
      return {
        enabled: true,
        preferenceId: result.id,
        initPoint: result.init_point,
        sandboxInitPoint: result.sandbox_init_point,
      };
    } catch (err) {
      console.error(`[MercadoPago] Error creating preference for pedido #${pedidoId}:`, err.message);
      throw err;
    }
  },

  /**
   * Get payment status from MercadoPago.
   */
  async getPaymentStatus(paymentId) {
    const enabled = await isEnabled();
    if (!enabled) {
      return { enabled: false, message: 'MercadoPago está desactivado' };
    }

    const client = await getClient();
    if (!client) {
      return { enabled: false, message: 'MercadoPago no está configurado correctamente' };
    }

    try {
      const payment = new MercadoPago.Payment(client);
      const result = await payment.get({ id: paymentId });
      return {
        enabled: true,
        paymentId: result.id,
        status: result.status,
        statusDetail: result.status_detail,
        externalReference: result.external_reference,
        transactionAmount: result.transaction_amount,
      };
    } catch (err) {
      console.error(`[MercadoPago] Error fetching payment #${paymentId}:`, err.message);
      throw err;
    }
  },

  /**
   * Handle a webhook notification from MercadoPago.
   * When a payment is approved, updates the corresponding pedido.
   */
  async handleWebhookNotification(body) {
    const enabled = await isEnabled();
    if (!enabled) {
      console.log('[MercadoPago] Webhook received but integration is disabled');
      return { processed: false, reason: 'disabled' };
    }

    const { type, data } = body;

    if (type !== 'payment') {
      console.log(`[MercadoPago] Ignoring webhook type: ${type}`);
      return { processed: false, reason: 'not_payment_type' };
    }

    if (!data || !data.id) {
      console.warn('[MercadoPago] Webhook missing data.id');
      return { processed: false, reason: 'missing_data' };
    }

    try {
      // Fetch the full payment details from MercadoPago
      const paymentInfo = await this.getPaymentStatus(data.id);

      if (!paymentInfo.enabled) {
        return { processed: false, reason: 'not_configured' };
      }

      // Extract pedido ID from external_reference (format: "pedido_123")
      const externalRef = paymentInfo.externalReference || '';
      const pedidoIdMatch = externalRef.match(/pedido_(\d+)/);
      if (!pedidoIdMatch) {
        console.warn(`[MercadoPago] Unknown external_reference: ${externalRef}`);
        return { processed: false, reason: 'unknown_reference' };
      }

      const pedidoId = parseInt(pedidoIdMatch[1], 10);
      const pedido = await pedidosRepo.getById(pedidoId);
      if (!pedido) {
        console.warn(`[MercadoPago] Pedido #${pedidoId} not found`);
        return { processed: false, reason: 'pedido_not_found' };
      }

      // Map MercadoPago status to our pago_estado
      const statusMap = {
        approved: 'pagado',
        pending: 'pendiente_pago',
        rejected: 'rechazado_pago',
        refunded: 'reembolsado',
      };

      const pagoEstado = statusMap[paymentInfo.status] || 'pendiente_pago';
      await pedidosRepo.updatePagoEstado(pedidoId, pagoEstado, `mp_${data.id}`);

      // If payment approved and order is pending, auto-confirm
      if (paymentInfo.status === 'approved' && pedido.estado === 'pendiente') {
        const { pedido: updated } = await pedidosRepo.updateEstado(pedidoId, 'confirmado', 'mercadopago');
        console.log(`[MercadoPago] Pedido #${pedidoId} auto-confirmed after payment approval`);
        return { processed: true, action: 'auto_confirmed', pedidoId };
      }

      console.log(`[MercadoPago] Updated pedido #${pedidoId} payment status to: ${pagoEstado}`);
      return { processed: true, action: 'payment_updated', pedidoId, pagoEstado };
    } catch (err) {
      console.error(`[MercadoPago] Error handling webhook:`, err.message);
      return { processed: false, reason: 'error', error: err.message };
    }
  },

};
