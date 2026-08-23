const configuracionRepo = require('../../repositories/configuracionRepository');
const logger = require('../../config/logger');
require('dotenv').config();

let axios = null;
try {
  axios = require('axios');
} catch (_err) {
  axios = null;
}

/**
 * Fetch available models dynamically from provider API (no hardcoding).
 */
async function listAvailableModels(provider, apiKey, baseUrl) {
  const models = [];

  // 1. Google Gemini Provider
  if (provider === 'gemini' || (!provider && apiKey?.startsWith('AIza'))) {
    const key = apiKey || process.env.GEMINI_API_KEY;

    if (key && axios) {
      try {
        const res = await axios.get(
          `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
          { timeout: 10000 }
        );
        if (res.data && res.data.models) {
          return res.data.models
            .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
            .map((m) => ({
              id: m.name.replace('models/', ''),
              name: m.displayName || m.name.replace('models/', ''),
              provider: 'gemini',
            }));
        }
      } catch (err) {
        logger.warn('LLM list models error (Gemini)', { error: err.message });
      }
    }

    // Fallback model list if offline/restricted key/missing key
    return [
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (Rápido)', provider: 'gemini' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (Avanzado)', provider: 'gemini' },
      { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash (Experimental)', provider: 'gemini' },
    ];
  }

  // 2. OpenAI / Compatible Provider (OpenAI, Groq, Together, DeepSeek, Ollama, etc.)
  const targetBaseUrl = baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const key = apiKey || process.env.OPENAI_API_KEY;

  if (axios && (key || targetBaseUrl.includes('localhost') || targetBaseUrl.includes('127.0.0.1'))) {
    try {
      const headers = key ? { Authorization: `Bearer ${key}` } : {};
      const res = await axios.get(`${targetBaseUrl.replace(/\/$/, '')}/models`, {
        headers,
        timeout: 10000,
      });

      if (res.data && res.data.data && Array.isArray(res.data.data)) {
        return res.data.data
          .filter((m) => !m.id.includes('embedding') && !m.id.includes('tts') && !m.id.includes('dall-e'))
          .map((m) => ({
            id: m.id,
            name: m.id,
            provider: 'openai',
          }));
      }
    } catch (err) {
      logger.warn('LLM list models error (OpenAI/Compatible)', { error: err.message });
    }
  }

  // Fallback model list if offline
  return [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
    { id: 'gpt-4o', name: 'GPT-4o (Avanzado)', provider: 'openai' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openai' },
  ];
}

/**
 * Post-processes and humanizes the LLM reply to strip robotic artifacts
 */
function cleanAndHumanizeReply(text = '', historyLength = 1) {
  if (!text) return '';
  let cleaned = text.trim();

  // Strip robotic disclaimers
  cleaned = cleaned.replace(/Como (asistente virtual|modelo de inteligencia artificial|IA|bot)[^.,\n]*[.,\n]/gi, '');
  cleaned = cleaned.replace(/Soy un asistente virtual[^.,\n]*[.,\n]/gi, '');
  cleaned = cleaned.replace(/Espero que esta respuesta le sea de utilidad\.?/gi, '');
  cleaned = cleaned.replace(/Espero haberle sido de ayuda\.?/gi, '');

  // If conversation is already in progress, strip repetitive greetings at the start
  if (historyLength > 1) {
    cleaned = cleaned.replace(/^(¡?(hola|buenos días|buenas tardes|buenas noches|estimado\/a|estimado cliente)[!,.\s]+)+/i, '');
    // Capitalize first character if needed
    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
  }

  return cleaned.trim();
}

/**
 * Call Google Gemini API dynamically with chosen model.
 */
async function callGemini(systemPrompt, userMessages, modelName, apiKey, temperature = 0.5) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY missing');

  const selectedModel = modelName || 'gemini-1.5-flash';
  const historyText = userMessages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
  const fullPrompt = `${systemPrompt}\n\nConversación:\n${historyText}\n\nASISTENTE:`;

  if (axios) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${key}`;
    const response = await axios.post(
      url,
      {
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: {
          temperature,
          topP: 0.95,
        },
      },
      { timeout: 15000 }
    );

    const candidates = response.data?.candidates;
    if (candidates && candidates[0]?.content?.parts[0]?.text) {
      return candidates[0].content.parts[0].text;
    }
  }

  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: selectedModel,
    generationConfig: { temperature },
  });
  const result = await model.generateContent(fullPrompt);
  return (await result.response).text();
}

/**
 * Call OpenAI or OpenAI-compatible API dynamically with chosen model & baseURL.
 */
async function callOpenAI(systemPrompt, userMessages, modelName, apiKey, baseUrl, temperature = 0.5) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  const targetBaseUrl = baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const selectedModel = modelName || 'gpt-4o-mini';

  const messages = [
    { role: 'system', content: systemPrompt },
    ...userMessages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
  ];

  if (axios) {
    const url = `${targetBaseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const response = await axios.post(
      url,
      {
        model: selectedModel,
        messages,
        temperature,
        presence_penalty: 0.2,
        frequency_penalty: 0.1,
      },
      { headers, timeout: 15000 }
    );

    return response.data?.choices[0]?.message?.content || '';
  }

  const OpenAI = require('openai');
  const openai = new OpenAI({ apiKey: key, baseURL: targetBaseUrl });
  const completion = await openai.chat.completions.create({
    model: selectedModel,
    messages,
    temperature,
    presence_penalty: 0.2,
    frequency_penalty: 0.1,
  });
  return completion.choices[0].message.content;
}

module.exports = {
  listAvailableModels,
  cleanAndHumanizeReply,

  async generateResponse(systemPrompt, userMessages) {
    // Read dynamic configuration from database
    const provider = (await configuracionRepo.get('llm_provider')) || (process.env.GEMINI_API_KEY ? 'gemini' : 'openai');
    const selectedModel = (await configuracionRepo.get('llm_model')) || (provider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini');
    const apiKey = (await configuracionRepo.get('llm_api_key')) || (provider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY);
    const baseUrl = (await configuracionRepo.get('llm_base_url')) || process.env.OPENAI_BASE_URL;
    const tempConfig = await configuracionRepo.get('llm_temperature');
    const temperature = tempConfig ? parseFloat(tempConfig) : 0.5;

    logger.info('LLM connector invoked', { provider, model: selectedModel, temperature });

    let rawReply = '';

    // 1. Execute Gemini Provider
    if (provider === 'gemini' && (apiKey || process.env.GEMINI_API_KEY)) {
      try {
        rawReply = await callGemini(systemPrompt, userMessages, selectedModel, apiKey, temperature);
      } catch (err) {
        logger.warn('LLM Gemini call failed, trying fallback', { error: err.message });
      }
    }

    // 2. Execute OpenAI / Compatible Provider
    if (!rawReply && (provider === 'openai' || provider === 'compatible' || process.env.OPENAI_API_KEY) && (apiKey || process.env.OPENAI_API_KEY || baseUrl)) {
      try {
        rawReply = await callOpenAI(systemPrompt, userMessages, selectedModel, apiKey, baseUrl, temperature);
      } catch (err) {
        logger.warn('LLM OpenAI/Compatible call failed', { error: err.message });
      }
    }

    // 3. Fallback heuristic response if both fail or offline
    if (!rawReply) {
      const lastUserMsg = userMessages[userMessages.length - 1]?.content || '';
      if (lastUserMsg.toLowerCase().includes('factura') || lastUserMsg.toLowerCase().includes('reclamo')) {
        return 'DERIVAR: administracion';
      }
      if (lastUserMsg.toLowerCase().includes('comprar') || lastUserMsg.toLowerCase().includes('pedido')) {
        return 'Con mucho gusto tomamos su pedido. Por favor facilítenos su nombre completo, teléfono, dirección de entrega y los artículos que precisa.';
      }
      rawReply = '¡Buenos días! Bienvenido a Kroser Uruguay. ¿En qué producto o consulta le podemos colaborar hoy?';
    }

    return cleanAndHumanizeReply(rawReply, userMessages.length);
  },
};
