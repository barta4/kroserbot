/**
 * Query Classifier (agente LLM) para búsqueda de productos.
 *
 * Interpreta mensajes coloquiales ("hola tenés disco amoladora") y devuelve
 * queries de catálogo estructuradas. El LLM SOLO genera queries; nunca respuestas.
 * Si el LLM falla, tarda o devuelve JSON inválido, el llamador usa el
 * clasificador por reglas (queryAnalyzer) como contingencia.
 */

const crypto = require('crypto');
const logger = require('../../config/logger');
const redis = require('../../config/redis');
const configuracionRepo = require('../../repositories/configuracionRepository');
const queryAnalyzer = require('../../utils/queryAnalyzer');
const { UY_SYNONYMS, detectAccessoryOfMachine } = require('../../utils/uyVocabulary');

const CACHE_TTL_SECONDS = 3600;
const DEFAULT_TIMEOUT_MS = 3500;
const MAX_QUERIES = 4;

function buildVocabularyHint() {
  return Object.entries(UY_SYNONYMS)
    .map(([k, v]) => `${k} = ${v.join(' / ')}`)
    .join('; ');
}

const SYSTEM_PROMPT = `Eres un clasificador de búsquedas de una cadena de ferreterías de Uruguay (Kroser).
Tu ÚNICA tarea: convertir el mensaje del cliente en queries cortas para buscar en el catálogo.
Responde SOLO con un JSON válido, sin texto adicional ni markdown.

Reglas:
- Ignora saludos, voseo y muletillas ("hola", "tenés", "fijate", "che", "me das").
- "X para Y" o "X de Y" / "X Y" donde X es accesorio/repuesto (disco, mecha, broca, hoja, filtro, repuesto) e Y una máquina: el cliente busca el ACCESORIO X, NO la máquina Y.
  Ejemplo: "tenés disco amoladora" -> producto "disco de corte", compatible_con "amoladora", queries ["disco corte amoladora","disco desbaste","disco abrasivo"].
- Traduce modismos uruguayos a términos de catálogo. Vocabulario: ${buildVocabularyHint()}.
- Conserva marca, modelo, medidas y códigos exactos si los hay.
- No inventes productos. Máximo ${MAX_QUERIES} queries, de más específica a más general.

Formato:
{"intencion":"buscar_producto|otro","producto":"...","compatible_con":"...|null","atributos":{"medida":null,"marca":null},"queries":["..."],"confianza":0.0}`;

/**
 * Extrae el primer objeto JSON de un texto (tolera ```json ... ```).
 */
function parseJsonLoose(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch (_e) {
    return null;
  }
}

/**
 * Valida y normaliza la salida del LLM.
 * @returns {{intencion:string, producto:string, compatible_con:string|null, atributos:Object, queries:string[], confianza:number}|null}
 */
function validateClassification(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const queries = (Array.isArray(raw.queries) ? raw.queries : [])
    .filter((q) => typeof q === 'string' && q.trim().length >= 2 && q.length <= 80)
    .map((q) => q.trim());
  if (queries.length === 0 && typeof raw.producto === 'string' && raw.producto.trim()) {
    queries.push(raw.producto.trim());
  }
  if (queries.length === 0) return null;

  const unique = Array.from(new Set(queries.map((q) => queryAnalyzer.normalizeQuery(q)))).slice(0, MAX_QUERIES);
  const confianza = Number.isFinite(Number(raw.confianza)) ? Number(raw.confianza) : 0.5;
  return {
    intencion: typeof raw.intencion === 'string' ? raw.intencion : 'buscar_producto',
    producto: typeof raw.producto === 'string' ? raw.producto.trim() : '',
    compatible_con: raw.compatible_con && raw.compatible_con !== 'null' ? String(raw.compatible_con) : null,
    atributos: raw.atributos && typeof raw.atributos === 'object' ? raw.atributos : {},
    queries: unique,
    confianza: Math.max(0, Math.min(1, confianza)),
  };
}

/**
 * ¿Vale la pena invocar al LLM? Se omite para SKU/códigos y consultas triviales.
 */
function shouldClassify(text) {
  const norm = queryAnalyzer.normalizeQuery(text);
  if (!norm) return false;
  if (queryAnalyzer.detectCode(norm).isCode) return false;
  const tokens = queryAnalyzer.tokenize(norm);
  // Un solo término sustantivo sin accesorio/máquina: la búsqueda por reglas alcanza
  if (tokens.length <= 1 && !detectAccessoryOfMachine(norm)) return false;
  return true;
}

async function defaultLlmCall(systemPrompt, userMessages) {
  // require perezoso para evitar dependencia circular (llmService -> toolExecutor -> classifier)
  const llmService = require('../llm/llmService');
  return await llmService.generateResponse(systemPrompt, userMessages, { temperature: 0 });
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('classifier timeout')), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Clasifica el mensaje del cliente.
 *
 * @param {string} userMessage - Mensaje crudo
 * @param {Object} [options]
 * @param {string} [options.context] - Últimos mensajes de la conversación (texto)
 * @param {Function} [options.llmCall] - Inyección para tests: (systemPrompt, messages) => Promise<string>
 * @returns {Promise<Object|null>} Clasificación o null si debe usarse el fallback por reglas
 */
async function classifyQuery(userMessage, options = {}) {
  const text = (userMessage || '').trim();
  if (!text || !shouldClassify(text)) return null;

  const injected = typeof options.llmCall === 'function';
  if (!injected && process.env.NODE_ENV === 'test') return null;

  try {
    const cfg = await configuracionRepo.getMultiple(['classifier_enabled', 'classifier_timeout_ms']);
    if (cfg && cfg.classifier_enabled === 'false') return null;
    const timeoutMs = parseInt(cfg && cfg.classifier_timeout_ms, 10) || DEFAULT_TIMEOUT_MS;

    const cacheKey = `qclass:${crypto.createHash('sha1').update(queryAnalyzer.normalizeQuery(text)).digest('hex')}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (_e) {
        /* ignore corrupt cache */
      }
    }

    const content = options.context ? `Contexto reciente:\n${options.context}\n\nMensaje actual: ${text}` : text;
    const llmCall = options.llmCall || defaultLlmCall;
    const reply = await withTimeout(llmCall(SYSTEM_PROMPT, [{ role: 'user', content }]), timeoutMs);

    const parsed = validateClassification(parseJsonLoose(typeof reply === 'string' ? reply : ''));
    if (!parsed) {
      logger.warn('[QueryClassifier] Respuesta inválida del LLM, usando fallback por reglas');
      return null;
    }

    await redis.set(cacheKey, JSON.stringify(parsed), 'EX', CACHE_TTL_SECONDS);
    logger.info('[QueryClassifier] Clasificación', { original: text, queries: parsed.queries, confianza: parsed.confianza });
    return parsed;
  } catch (err) {
    logger.warn('[QueryClassifier] Falló, usando fallback por reglas', { error: err.message });
    return null;
  }
}

module.exports = {
  classifyQuery,
  parseJsonLoose,
  validateClassification,
  shouldClassify,
  SYSTEM_PROMPT,
};
