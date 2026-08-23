const mercadopagoService = require('../services/mercadopago/mercadopagoService');
const { mercadopagoToggleSchema, mercadopagoPreferenceSchema } = require('../schemas');
const { validate } = require('../schemas/validate');
const logger = require('../config/logger');

module.exports = {
  async handleWebhook(req, res) {
    try {
      res.status(200).json({ received: true });

      const body = req.body;
      if (!body || !body.type) {
        logger.info('MercadoPago webhook: empty or invalid payload');
        return;
      }

      const result = await mercadopagoService.handleWebhookNotification(body);
      logger.info('MercadoPago webhook result', { result: JSON.stringify(result) });
    } catch (err) {
      logger.error('MercadoPago webhook error', { error: err.message });
    }
  },

  async getStatus(req, res, next) {
    try {
      const enabled = await mercadopagoService.isEnabled();
      res.json({ enabled });
    } catch (err) {
      next(err);
    }
  },

  async toggle(req, res, next) {
    try {
      const result = validate(mercadopagoToggleSchema, req.body);
      if (!result.valid) {
        return res.status(400).json({ error: 'Payload inválido', details: result.errors });
      }
      const { enabled } = result.data;

      const toggleResult = await mercadopagoService.toggle(enabled);
      res.json(toggleResult);
    } catch (err) {
      next(err);
    }
  },

  async createPreference(req, res, next) {
    try {
      const result = validate(mercadopagoPreferenceSchema, req.body);
      if (!result.valid) {
        return res.status(400).json({ error: 'Payload inválido', details: result.errors });
      }
      const { pedido_id } = result.data;

      const prefResult = await mercadopagoService.createPreference(pedido_id);
      if (!prefResult.enabled) {
        return res.status(503).json(prefResult);
      }

      res.json(prefResult);
    } catch (err) {
      next(err);
    }
  },
};
