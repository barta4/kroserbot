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
      const {
        provider,
        model,
        apiKey,
        baseUrl,
        fallbackProvider,
        fallbackModel,
        fallbackApiKey,
        fallbackBaseUrl,
        fallbackEnabled,
      } = result.data;

      if (provider) await configuracionRepo.set('llm_provider', provider);
      if (model) await configuracionRepo.set('llm_model', model);
      if (apiKey !== undefined) await configuracionRepo.set('llm_api_key', apiKey);
      if (baseUrl !== undefined) await configuracionRepo.set('llm_base_url', baseUrl);

      if (fallbackProvider) await configuracionRepo.set('llm_fallback_provider', fallbackProvider);
      if (fallbackModel) await configuracionRepo.set('llm_fallback_model', fallbackModel);
      if (fallbackApiKey !== undefined) await configuracionRepo.set('llm_fallback_api_key', fallbackApiKey);
      if (fallbackBaseUrl !== undefined) await configuracionRepo.set('llm_fallback_base_url', fallbackBaseUrl);
      if (fallbackEnabled !== undefined) {
        await configuracionRepo.set('llm_failsafe_enabled', String(fallbackEnabled) === 'true' || fallbackEnabled === true ? 'true' : 'false');
      }

      res.json({
        success: true,
        message: 'Configuración de LLM y Fail-Safe guardada exitosamente',
        config: {
          provider,
          model,
          apiKey: apiKey ? '***' : '',
          baseUrl,
          fallbackProvider,
          fallbackModel,
          fallbackApiKey: fallbackApiKey ? '***' : '',
          fallbackBaseUrl,
          fallbackEnabled,
        },
      });
    } catch (err) {
      next(err);
    }
  },
};
