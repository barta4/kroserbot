const configuracionRepo = require('../repositories/configuracionRepository');
const promptHistoryRepo = require('../repositories/promptHistoryRepository');

const SECRET_KEYS = new Set([
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'llm_api_key',
  'chatwoot_api_token',
  'chatwoot_base_url',
  'mercadopago_access_token',
  'mercadopago_public_key',
  'mercadopago_webhook_secret',
  'SMTP_PASS',
  'smtp_pass',
  'sql_directo_url',
  'api_productos_key',
]);

module.exports = {
  async getConfig(req, res, next) {
    try {
      const config = await configuracionRepo.getAll();
      const sanitized = {};
      for (const key of Object.keys(config)) {
        if (!SECRET_KEYS.has(key)) {
          sanitized[key] = config[key];
        }
      }
      res.json(sanitized);
    } catch (err) {
      next(err);
    }
  },

  async updateConfig(req, res, next) {
    try {
      const { key, value } = req.body;
      if (!key || value === undefined) {
        return res.status(400).json({ error: 'Campos key y value son requeridos' });
      }
      if (typeof key !== 'string' || typeof value !== 'string') {
        return res.status(400).json({ error: 'key y value deben ser strings' });
      }
      const updated = await configuracionRepo.set(key, value);

      if (key === 'system_prompt') {
        const cambiadoPor = req.user ? req.user.username : 'unknown';
        await promptHistoryRepo.addVersion(value, cambiadoPor);
      }

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },

  async getHistory(req, res, next) {
    try {
      const history = await promptHistoryRepo.getHistory();
      res.json(history);
    } catch (err) {
      next(err);
    }
  },
};
