/**
 * Cliente HTTP para la API de Facturapp.
 *
 * Seguridad:
 * - La clave se lee ÚNICAMENTE de process.env.FACTURAPP_API_KEY.
 * - Nunca se incluye la clave en mensajes, logs ni URLs.
 * - Solo el backend realiza las consultas.
 */
const DEFAULT_BASE_URL = 'https://mcp.facturapp.com.uy';
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_RETRIES = 2;
const RETRYABLE_STATUS = new Set([429, 500, 503]);
const RETRY_BASE_MS = Math.max(1, parseInt(process.env.FACTURAPP_RETRY_BASE_MS || '1000', 10) || 1000);

class FacturappError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'FacturappError';
    this.status = options.status || null;
    this.code = options.code || 'facturapp_error';
    this.requestId = options.requestId || null;
    this.retryable = options.retryable === true;
  }
}

function getApiKey() {
  const key = process.env.FACTURAPP_API_KEY;
  if (!key || !String(key).trim()) {
    throw new FacturappError('FACTURAPP_API_KEY no está configurada', {
      code: 'missing_api_key',
      retryable: false,
    });
  }
  return String(key).trim();
}

function getBaseUrl() {
  return (process.env.FACTURAPP_API_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function getTimeoutMs() {
  const parsed = parseInt(process.env.FACTURAPP_TIMEOUT_MS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 30000));
  return null;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_err) {
    return {};
  }
}

/**
 * Ejecuta una operación de la API.
 * @param {string} operation - Ejemplo: 'articulos/listar'
 * @param {object} params - Query params
 * @param {object} options - { retries }
 */
async function request(operation, params = {}, options = {}) {
  const key = getApiKey();
  const baseUrl = getBaseUrl();
  const url = new URL(`${baseUrl}/api/${operation}`);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(name, String(value));
    }
  }

  const retries = Number.isInteger(options.retries) ? options.retries : MAX_RETRIES;
  let attempt = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), getTimeoutMs());

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      const json = await readJson(response);
      const requestId = json.requestId || response.headers.get('x-request-id') || null;

      if (response.ok) {
        return {
          ok: json.ok !== false,
          operation: json.operacion || operation,
          data: json.datos,
          siguienteDesdeId: json.siguienteDesdeId ?? null,
          creditos: json.creditos || null,
          consultadoEn: json.consultadoEn || null,
          requestId,
          raw: json,
        };
      }

      const message = json?.error?.message || `Facturapp respondió HTTP ${response.status}`;
      const err = new FacturappError(message, {
        status: response.status,
        code: json?.error?.type || `http_${response.status}`,
        requestId,
        retryable: RETRYABLE_STATUS.has(response.status),
      });

      if (err.retryable && attempt < retries) {
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
        const backoff = retryAfter !== null ? retryAfter : Math.min(RETRY_BASE_MS * 2 ** attempt, 8000);
        await sleep(backoff);
        attempt += 1;
        continue;
      }

      throw err;
    } catch (err) {
      if (err instanceof FacturappError) throw err;

      const isAbort = err && err.name === 'AbortError';
      const retryable = isAbort || err instanceof TypeError; // timeout / error de red

      if (retryable && attempt < retries) {
        await sleep(Math.min(RETRY_BASE_MS * 2 ** attempt, 8000));
        attempt += 1;
        continue;
      }

      throw new FacturappError(
        isAbort ? 'Timeout al consultar Facturapp' : 'No se pudo conectar con Facturapp',
        { code: isAbort ? 'timeout' : 'network_error', retryable }
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

async function getCatalog() {
  return request('catalogo');
}

async function getBalance() {
  const res = await request('cuenta/saldo');
  const datos = res.data || {};
  const creditos = res.creditos || {};
  return {
    plan: datos.plan || creditos.plan || null,
    mensuales: Number(datos.mensuales ?? creditos.mensuales ?? 0),
    usadosMes: Number(datos.usadosMes ?? creditos.usadosMes ?? 0),
    disponiblesMes: Number(datos.disponiblesMes ?? creditos.disponiblesMes ?? 0),
    extra: Number(datos.extra ?? creditos.extra ?? 0),
    mes: datos.mes || creditos.mes || null,
    vigenteHasta: datos.vigenteHasta || null,
    renovacionAutomatica: Boolean(datos.renovacionAutomatica),
    requestId: res.requestId,
  };
}

/**
 * Lista artículos por lotes. Cada página consume 1 crédito.
 * @param {object} options - { desdeId, cantidad, soloActivos, modificadosDesde }
 */
async function listArticles(options = {}) {
  const params = {
    desdeId: options.desdeId ?? 0,
    cantidad: Math.min(Math.max(options.cantidad || 200, 1), 200),
    soloActivos: options.soloActivos === true ? 'true' : 'false',
    modificadosDesde: options.modificadosDesde || undefined,
  };
  const res = await request('articulos/listar', params);
  return {
    articles: Array.isArray(res.data) ? res.data : [],
    siguienteDesdeId: res.siguienteDesdeId,
    creditos: res.creditos,
    requestId: res.requestId,
    raw: res.raw,
  };
}

module.exports = {
  FacturappError,
  getCatalog,
  getBalance,
  listArticles,
  request,
};
