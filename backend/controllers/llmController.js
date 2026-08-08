const llmService = require('../services/llm/llmService');
const configuracionRepo = require('../repositories/configuracionRepository');

module.exports = {
  async getModels(req, res, next) {
    try {
      const { provider, apiKey, baseUrl } = req.query;
      const models = await llmService.listAvailableModels(provider, apiKey, baseUrl);
      res.json({ models });
    } catch (err) {
      next(err);
    }
  },

  async saveConfig(req, res, next) {
    try {
      const { provider, model, apiKey, baseUrl } = req.body;
      if (provider) await configuracionRepo.set('llm_provider', provider);
      if (model) await configuracionRepo.set('llm_model', model);
      if (apiKey !== undefined) await configuracionRepo.set('llm_api_key', apiKey);
      if (baseUrl !== undefined) await configuracionRepo.set('llm_base_url', baseUrl);

      res.json({
        success: true,
        message: 'Configuración de LLM guardada exitosamente',
        config: { provider, model, apiKey: apiKey ? '***' : '', baseUrl },
      });
    } catch (err) {
      next(err);
    }
  },
};
