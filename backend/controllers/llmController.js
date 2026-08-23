const llmService = require('../services/llm/llmService');
const configuracionRepo = require('../repositories/configuracionRepository');
const { llmModelsSchema, llmConfigSchema } = require('../schemas');
const { validate } = require('../schemas/validate');

module.exports = {
  async getModels(req, res, next) {
    try {
      const result = validate(llmModelsSchema, req.body);
      if (!result.valid) {
        return res.status(400).json({ error: 'Payload inválido', details: result.errors });
      }
      const { provider, apiKey, baseUrl } = result.data;
      const models = await llmService.listAvailableModels(provider, apiKey, baseUrl);
      res.json({ models });
    } catch (err) {
      next(err);
    }
  },

  async saveConfig(req, res, next) {
    try {
      const result = validate(llmConfigSchema, req.body);
      if (!result.valid) {
        return res.status(400).json({ error: 'Payload inválido', details: result.errors });
      }
      const { provider, model, apiKey, baseUrl } = result.data;
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
