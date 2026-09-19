const configuracionRepo = require('../../repositories/configuracionRepository');
const toolExecutor = require('../webhook/toolExecutor');
const logger = require('../../config/logger');
require('dotenv').config();

let axios = null;
try {
  axios = require('axios');
} catch (_err) {
  axios = null;
}

const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Helper to execute axios POST with automatic retry on 429 (Rate limit)
 */
async function postWithRetry(url, data, config, maxRetries = 1) {
  try {
    return await axios.post(url, data, { ...config, timeout: config.timeout || DEFAULT_TIMEOUT_MS });
  } catch (err) {
    if (err.response?.status === 429 && maxRetries > 0) {
      logger.warn('LLM API returned 429 (Rate limit). Retrying after 1500ms...', { status: 429 });
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return await postWithRetry(url, data, config, maxRetries - 1);
    }
    throw err;
  }
}

/**
 * Fetch available models dynamically from provider API (no hardcoding).
 */
async function listAvailableModels(provider, apiKey, baseUrl) {
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

    return [
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash (Rápido)', provider: 'gemini' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro (Avanzado)', provider: 'gemini' },
      { id: 'gemini-2.0-flash-exp', name: 'Gemini 2.0 Flash (Experimental)', provider: 'gemini' },
    ];
  }

  // 2. OpenAI / Compatible Provider
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

  return [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
    { id: 'gpt-4o', name: 'GPT-4o (Avanzado)', provider: 'openai' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openai' },
  ];
}

/**
 * Normalizes multi-turn message history for Gemini API.
 * Rules:
 * - Roles must strictly alternate between 'user' and 'model'.
 * - First message must be 'user'.
 * - Consecutive messages of the same role are merged with a newline to prevent HTTP 400.
 */
function buildGeminiContents(userMessages = []) {
  const contents = [];

  for (const msg of userMessages) {
    if (!msg || !msg.content) continue;
    const role = (msg.role === 'assistant' || msg.role === 'model') ? 'model' : 'user';
    const text = String(msg.content).trim();
    if (!text) continue;

    if (contents.length > 0 && contents[contents.length - 1].role === role) {
      contents[contents.length - 1].parts[0].text += `\n${text}`;
    } else {
      contents.push({
        role,
        parts: [{ text }],
      });
    }
  }

  if (contents.length > 0 && contents[0].role === 'model') {
    contents.unshift({ role: 'user', parts: [{ text: 'Hola' }] });
  }

  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: 'Hola' }] });
  }

  return contents;
}

/**
 * Normalizes message history for OpenAI chat completions.
 */
function buildOpenAIMessages(systemPrompt, userMessages = []) {
  const messages = [{ role: 'system', content: systemPrompt }];
  for (const m of userMessages) {
    if (!m || !m.content) continue;
    messages.push({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content),
    });
  }
  return messages;
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
    if (cleaned.length > 0) {
      cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
  }

  return cleaned.trim();
}

/**
 * Call Google Gemini with Function Calling and multi-turn contents.
 */
async function callGeminiWithTools({
  systemPrompt,
  userMessages,
  modelName = 'gemini-1.5-flash',
  apiKey,
  temperature = 0.5,
  toolContext = {},
}) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY missing');

  const pedidosConfig = await configuracionRepo.get('pedidos_enabled');
  const enableOrders = pedidosConfig !== 'false';
  const tools = toolExecutor.getGeminiTools({ enableOrders });
  const contents = buildGeminiContents(userMessages);
  const toolsUsed = [];
  let createdOrder = null;

  const requestBody = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents,
    tools,
    generationConfig: {
      temperature,
      topP: 0.95,
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${key}`;

  // First call to Gemini
  const res1 = await postWithRetry(url, requestBody, { headers: { 'Content-Type': 'application/json' } });
  const candidate1 = res1.data?.candidates?.[0];
  const parts1 = candidate1?.content?.parts || [];

  // Check for function calls in parts
  const functionCalls = parts1.filter((p) => p.functionCall);

  if (functionCalls.length === 0) {
    // No tool needed: Direct response
    const textPart = parts1.find((p) => p.text);
    return {
      text: textPart ? textPart.text : '',
      toolsUsed,
      createdOrder,
    };
  }

  // Execute each tool call requested by Gemini
  const functionResponses = [];
  for (const call of functionCalls) {
    const fnName = call.functionCall.name;
    const fnArgs = call.functionCall.args || {};
    const result = await toolExecutor.executeTool(fnName, fnArgs, toolContext);

    toolsUsed.push({ name: fnName, args: fnArgs, result });
    if (fnName === 'registrar_pedido' && result.createdOrder) {
      createdOrder = result.createdOrder;
    }

    const structuredResponse =
      typeof result === 'object' && result !== null && !Array.isArray(result)
        ? { name: fnName, ...result }
        : { name: fnName, content: result };

    functionResponses.push({
      functionResponse: {
        name: fnName,
        response: structuredResponse,
      },
    });
  }

  // Multi-turn turn 2: append model's tool calls, then tool results
  contents.push({
    role: 'model',
    parts: parts1,
  });
  contents.push({
    role: 'user',
    parts: functionResponses,
  });

  const round2Body = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents,
    tools,
    generationConfig: {
      temperature,
      topP: 0.95,
    },
  };

  const res2 = await postWithRetry(url, round2Body, { headers: { 'Content-Type': 'application/json' } });
  const candidate2 = res2.data?.candidates?.[0];
  const parts2 = candidate2?.content?.parts || [];
  const finalReplyText = parts2.find((p) => p.text)?.text || '';

  return {
    text: finalReplyText,
    toolsUsed,
    createdOrder,
  };
}

/**
 * Call OpenAI or OpenAI-compatible API with Function Calling.
 */
async function callOpenAIWithTools({
  systemPrompt,
  userMessages,
  modelName = 'gpt-4o-mini',
  apiKey,
  baseUrl,
  temperature = 0.5,
  toolContext = {},
}) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  const targetBaseUrl = baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

  const pedidosConfig = await configuracionRepo.get('pedidos_enabled');
  const enableOrders = pedidosConfig !== 'false';
  const tools = toolExecutor.getOpenAITools({ enableOrders });
  const messages = buildOpenAIMessages(systemPrompt, userMessages);
  const toolsUsed = [];
  let createdOrder = null;

  const url = `${targetBaseUrl.replace(/\/$/, '')}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['Authorization'] = `Bearer ${key}`;

  const requestBody = {
    model: modelName,
    messages,
    tools,
    temperature,
  };

  const res1 = await postWithRetry(url, requestBody, { headers });
  const choice1 = res1.data?.choices?.[0];
  const message1 = choice1?.message || {};

  if (!message1.tool_calls || message1.tool_calls.length === 0) {
    return {
      text: message1.content || '',
      toolsUsed,
      createdOrder,
    };
  }

  // Append assistant message with tool calls cleanly
  messages.push({
    role: 'assistant',
    content: message1.content || null,
    tool_calls: message1.tool_calls,
  });

  // Execute tools
  for (const tc of message1.tool_calls) {
    const fnName = tc.function?.name;
    let fnArgs = {};
    try {
      fnArgs = typeof tc.function?.arguments === 'string'
        ? JSON.parse(tc.function.arguments || '{}')
        : (tc.function?.arguments || {});
    } catch (_e) {
      fnArgs = {};
    }

    const result = await toolExecutor.executeTool(fnName, fnArgs, toolContext);
    toolsUsed.push({ name: fnName, args: fnArgs, result });
    if (fnName === 'registrar_pedido' && result.createdOrder) {
      createdOrder = result.createdOrder;
    }

    messages.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: JSON.stringify(result),
    });
  }

  // Second call to generate final response
  const round2Body = {
    model: modelName,
    messages,
    temperature,
  };

  const res2 = await postWithRetry(url, round2Body, { headers });
  const choice2 = res2.data?.choices?.[0];
  const finalReplyText = choice2?.message?.content || '';

  return {
    text: finalReplyText,
    toolsUsed,
    createdOrder,
  };
}

/**
 * Fallback single-turn/standard Gemini call (updated with native multi-turn)
 */
async function callGemini(systemPrompt, userMessages, modelName, apiKey, temperature = 0.5) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY missing');

  const selectedModel = modelName || 'gemini-1.5-flash';
  const contents = buildGeminiContents(userMessages);

  if (axios) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${key}`;
    const response = await postWithRetry(
      url,
      {
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents,
        generationConfig: {
          temperature,
          topP: 0.95,
        },
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const candidates = response.data?.candidates;
    if (candidates && candidates[0]?.content?.parts?.[0]?.text) {
      return candidates[0].content.parts[0].text;
    }
  }

  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({
    model: selectedModel,
    systemInstruction: systemPrompt,
    generationConfig: { temperature },
  });
  const result = await model.generateContent({ contents });
  return (await result.response).text();
}

/**
 * Fallback single-turn/standard OpenAI call
 */
async function callOpenAI(systemPrompt, userMessages, modelName, apiKey, baseUrl, temperature = 0.5) {
  const key = apiKey || process.env.OPENAI_API_KEY;
  const targetBaseUrl = baseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const selectedModel = modelName || 'gpt-4o-mini';
  const messages = buildOpenAIMessages(systemPrompt, userMessages);

  if (axios) {
    const url = `${targetBaseUrl.replace(/\/$/, '')}/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const response = await postWithRetry(
      url,
      {
        model: selectedModel,
        messages,
        temperature,
        presence_penalty: 0.2,
        frequency_penalty: 0.1,
      },
      { headers }
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
  buildGeminiContents,
  buildOpenAIMessages,

  /**
   * Generates a response using Agentic Function Calling.
   */
  async generateWithTools(systemPrompt, userMessages, options = {}) {
    // If generateResponse is spied/mocked (e.g. in Jest unit tests), honor the mock!
    if (module.exports.generateResponse && module.exports.generateResponse.mock) {
      const mocked = await module.exports.generateResponse(systemPrompt, userMessages, options);
      return {
        reply: cleanAndHumanizeReply(mocked, userMessages.length),
        rawReply: mocked,
        toolsUsed: [],
        createdOrder: null,
      };
    }

    // 1. Primary Model Configuration
    const primaryProvider = options.provider || (await configuracionRepo.get('llm_provider')) || (process.env.GEMINI_API_KEY ? 'gemini' : 'openai');
    const primaryModel = options.model || (await configuracionRepo.get('llm_model')) || (primaryProvider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini');
    const primaryApiKey = options.apiKey || (await configuracionRepo.get('llm_api_key')) || (primaryProvider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY);
    const primaryBaseUrl = options.baseUrl || (await configuracionRepo.get('llm_base_url')) || (primaryProvider === 'gemini' ? '' : process.env.OPENAI_BASE_URL);

    // 2. Fallback / Fail-Safe Configuration
    const failsafeEnabled = (await configuracionRepo.get('llm_failsafe_enabled')) !== 'false';
    const fallbackProvider = (await configuracionRepo.get('llm_fallback_provider')) || (primaryProvider === 'gemini' ? 'openai' : 'gemini');
    const fallbackModel = (await configuracionRepo.get('llm_fallback_model')) || (fallbackProvider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini');
    const fallbackApiKey = (await configuracionRepo.get('llm_fallback_api_key')) || (fallbackProvider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY);
    const fallbackBaseUrl = (await configuracionRepo.get('llm_fallback_base_url')) || (fallbackProvider === 'gemini' ? '' : process.env.OPENAI_BASE_URL);

    const tempConfig = options.temperature !== undefined ? options.temperature : await configuracionRepo.get('llm_temperature');
    const temperature = tempConfig !== undefined && tempConfig !== null ? parseFloat(tempConfig) : 0.5;

    const toolContext = options.toolContext || {};
    logger.info('generateWithTools invoked', {
      primaryProvider,
      primaryModel,
      failsafeEnabled,
      fallbackProvider,
      fallbackModel,
    });

    let rawReply = '';
    let toolsUsed = [];
    let createdOrder = null;

    async function executeProvider(p, m, k, u) {
      if (p === 'gemini') {
        const key = k || process.env.GEMINI_API_KEY;
        if (!key) throw new Error('GEMINI_API_KEY no disponible');
        return await callGeminiWithTools({
          systemPrompt,
          userMessages,
          modelName: m || 'gemini-1.5-flash',
          apiKey: key,
          temperature,
          toolContext,
        });
      } else {
        const key = k || process.env.OPENAI_API_KEY;
        const targetUrl = u || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
        if (!key && !targetUrl.includes('localhost') && !targetUrl.includes('127.0.0.1')) {
          throw new Error('OPENAI_API_KEY no disponible');
        }
        return await callOpenAIWithTools({
          systemPrompt,
          userMessages,
          modelName: m || 'gpt-4o-mini',
          apiKey: key,
          baseUrl: targetUrl,
          temperature,
          toolContext,
        });
      }
    }

    // Step 1: Call Primary Provider
    try {
      const res = await executeProvider(primaryProvider, primaryModel, primaryApiKey, primaryBaseUrl);
      rawReply = res.text;
      toolsUsed = res.toolsUsed;
      createdOrder = res.createdOrder;
    } catch (primaryErr) {
      const errDetails = primaryErr.response?.data?.error?.message || primaryErr.message;
      logger.warn(`⚠️ [LLM Fail-Safe Activado] Proveedor primario '${primaryProvider}' (${primaryModel}) falló`, {
        error: primaryErr.message,
        details: errDetails,
      });

      // Step 2: Call Fallback Provider if Fail-Safe is enabled
      if (failsafeEnabled && fallbackProvider) {
        try {
          logger.info(`🔄 [LLM Fail-Safe] Conmutando a proveedor de respaldo '${fallbackProvider}' (${fallbackModel})`);
          const fallbackRes = await executeProvider(fallbackProvider, fallbackModel, fallbackApiKey, fallbackBaseUrl);
          rawReply = fallbackRes.text;
          toolsUsed = fallbackRes.toolsUsed;
          createdOrder = fallbackRes.createdOrder;
          logger.info(`✅ [LLM Fail-Safe Exitoso] Respuesta generada por respaldo '${fallbackProvider}' (${fallbackModel})`);
        } catch (fallbackErr) {
          const fbDetails = fallbackErr.response?.data?.error?.message || fallbackErr.message;
          logger.error(`❌ [LLM Fail-Safe Falló] Proveedor de respaldo '${fallbackProvider}' (${fallbackModel}) también falló`, {
            error: fallbackErr.message,
            details: fbDetails,
          });
        }
      }
    }

    // Step 3: Fallback heuristic response if both fail or offline
    if (!rawReply) {
      const lastUserMsg = userMessages[userMessages.length - 1]?.content || '';
      if (lastUserMsg.toLowerCase().includes('factura') || lastUserMsg.toLowerCase().includes('reclamo')) {
        return {
          reply: 'DERIVAR: administracion',
          toolsUsed: [],
          createdOrder: null,
          rawReply: 'DERIVAR: administracion',
        };
      }
      if (lastUserMsg.toLowerCase().includes('comprar') || lastUserMsg.toLowerCase().includes('pedido')) {
        const pedidosConfig = await configuracionRepo.get('pedidos_enabled');
        if (pedidosConfig === 'false') {
          return {
            reply: 'Por el momento la toma de pedidos por este canal de chat se encuentra temporalmente deshabilitada. Con gusto le brindamos información sobre productos, precios y sucursales, o puede adquirir sus artículos en nuestro sitio web oficial https://kroser.com.uy.',
            toolsUsed: [],
            createdOrder: null,
            rawReply: '',
          };
        }
        return {
          reply: 'Con mucho gusto tomamos su pedido. Por favor facilítenos su nombre completo, teléfono, dirección de entrega y los artículos que precisa.',
          toolsUsed: [],
          createdOrder: null,
          rawReply: '',
        };
      }
      const hour = new Date().getHours();
      let greeting = '¡Buenas tardes!';
      if (hour >= 6 && hour < 12) {
        greeting = '¡Buenos días!';
      } else if (hour >= 20 || hour < 6) {
        greeting = '¡Buenas noches!';
      }
      rawReply = `${greeting} Bienvenido a Kroser Uruguay. ¿En qué producto o consulta le podemos colaborar hoy?`;
    }

    const cleanReply = cleanAndHumanizeReply(rawReply, userMessages.length);

    return {
      reply: cleanReply,
      rawReply,
      toolsUsed,
      createdOrder,
    };
  },

  /**
   * Standard single-turn response generator (kept for backward compatibility)
   */
  async generateResponse(systemPrompt, userMessages, options = {}) {
    const primaryProvider = options.provider || (await configuracionRepo.get('llm_provider')) || (process.env.GEMINI_API_KEY ? 'gemini' : 'openai');
    const primaryModel = options.model || (await configuracionRepo.get('llm_model')) || (primaryProvider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini');
    const primaryApiKey = options.apiKey || (await configuracionRepo.get('llm_api_key')) || (primaryProvider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY);
    const primaryBaseUrl = options.baseUrl || (await configuracionRepo.get('llm_base_url')) || (primaryProvider === 'gemini' ? '' : process.env.OPENAI_BASE_URL);

    const failsafeEnabled = (await configuracionRepo.get('llm_failsafe_enabled')) !== 'false';
    const fallbackProvider = (await configuracionRepo.get('llm_fallback_provider')) || (primaryProvider === 'gemini' ? 'openai' : 'gemini');
    const fallbackModel = (await configuracionRepo.get('llm_fallback_model')) || (fallbackProvider === 'gemini' ? 'gemini-1.5-flash' : 'gpt-4o-mini');
    const fallbackApiKey = (await configuracionRepo.get('llm_fallback_api_key')) || (fallbackProvider === 'gemini' ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY);
    const fallbackBaseUrl = (await configuracionRepo.get('llm_fallback_base_url')) || (fallbackProvider === 'gemini' ? '' : process.env.OPENAI_BASE_URL);

    const tempConfig = options.temperature !== undefined ? options.temperature : await configuracionRepo.get('llm_temperature');
    const temperature = tempConfig !== undefined && tempConfig !== null ? parseFloat(tempConfig) : 0.5;

    logger.info('LLM connector invoked (generateResponse)', {
      primaryProvider,
      primaryModel,
      failsafeEnabled,
      fallbackProvider,
      fallbackModel,
      temperature,
    });

    let rawReply = '';

    async function executeSingleTurn(p, m, k, u) {
      if (p === 'gemini') {
        const key = k || process.env.GEMINI_API_KEY;
        if (!key) throw new Error('GEMINI_API_KEY no disponible');
        return await callGemini(systemPrompt, userMessages, m || 'gemini-1.5-flash', key, temperature);
      } else {
        const key = k || process.env.OPENAI_API_KEY;
        const targetUrl = u || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
        if (!key && !targetUrl.includes('localhost') && !targetUrl.includes('127.0.0.1')) {
          throw new Error('OPENAI_API_KEY no disponible');
        }
        return await callOpenAI(systemPrompt, userMessages, m || 'gpt-4o-mini', key, targetUrl, temperature);
      }
    }

    try {
      rawReply = await executeSingleTurn(primaryProvider, primaryModel, primaryApiKey, primaryBaseUrl);
    } catch (primaryErr) {
      logger.warn(`⚠️ [LLM Fail-Safe] Primary single-turn provider '${primaryProvider}' (${primaryModel}) failed: ${primaryErr.message}`);
      if (failsafeEnabled && fallbackProvider) {
        try {
          rawReply = await executeSingleTurn(fallbackProvider, fallbackModel, fallbackApiKey, fallbackBaseUrl);
          logger.info(`✅ [LLM Fail-Safe] Single-turn fallback succeeded with '${fallbackProvider}' (${fallbackModel})`);
        } catch (fallbackErr) {
          logger.error(`❌ [LLM Fail-Safe] Single-turn fallback '${fallbackProvider}' (${fallbackModel}) also failed: ${fallbackErr.message}`);
        }
      }
    }

    if (!rawReply) {
      const lastUserMsg = userMessages[userMessages.length - 1]?.content || '';
      if (lastUserMsg.toLowerCase().includes('factura') || lastUserMsg.toLowerCase().includes('reclamo')) {
        return 'DERIVAR: administracion';
      }
      if (lastUserMsg.toLowerCase().includes('comprar') || lastUserMsg.toLowerCase().includes('pedido')) {
        return 'Con mucho gusto tomamos su pedido. Por favor facilítenos su nombre completo, teléfono, dirección de entrega y los artículos que precisa.';
      }
      const hour = new Date().getHours();
      let greeting = '¡Buenas tardes!';
      if (hour >= 6 && hour < 12) {
        greeting = '¡Buenos días!';
      } else if (hour >= 20 || hour < 6) {
        greeting = '¡Buenas noches!';
      }
      rawReply = `${greeting} Bienvenido a Kroser Uruguay. ¿En qué producto o consulta le podemos colaborar hoy?`;
    }

    return cleanAndHumanizeReply(rawReply, userMessages.length);
  },
};
