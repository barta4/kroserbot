const db = require('../config/db');
const { encrypt, decrypt } = require('../utils/cryptoUtils');
const logger = require('../config/logger');

const DEFAULTS = Object.freeze({
  system_prompt: 'Sos el asistente virtual de Kroser Uruguay. Tu objetivo es ayudar a los clientes a encontrar productos del catálogo, responder consultas sobre sucursales, precios y envíos, y asistir en la toma de pedidos.',
  msg_pedido_pendiente: 'Tu pedido pasó a revisión humana, en breve te confirmamos.',
  msg_pedido_listo: '¡Tu pedido fue confirmado! Te contactamos para coordinar la entrega.',
  msg_pedido_rechazado: 'Lamentamos informarte que no pudimos procesar tu pedido. Un asesor te contactará.',
  msg_derivacion: 'Te estoy derivando con un asesor humano que va a poder ayudarte mejor.',
  bot_loop_shield_enabled: 'true',
  bot_max_turns_limit: '15',
  msg_limite_turnos: 'Hemos alcanzado el límite de respuestas automáticas para esta consulta. En breve un asesor de nuestro equipo continuará la atención personalizada.',
  pedidos_enabled: 'true',
  auto_resolve_on_farewell: 'true',
  auto_resolve_timeout_minutes: '15',
  auto_resolve_label: 'resuelto-bot',
  llm_provider: 'gemini',
  llm_model: 'gemini-1.5-flash',
  llm_failsafe_enabled: 'true',
  llm_fallback_provider: 'openai',
  llm_fallback_model: 'gpt-4o-mini',
  llm_fallback_base_url: '',
  business_hours_weekday_start: '09:00',
  business_hours_weekday_end: '18:00',
  business_hours_saturday_enabled: 'true',
  business_hours_saturday_start: '09:00',
  business_hours_saturday_end: '13:00',
  contact_alternative_email: 'atencion@kroser.com.uy',
  msg_fuera_de_horario: '',
});

const ENCRYPTED_KEYS = new Set([
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'llm_api_key',
  'llm_fallback_api_key',
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

const inMemoryConfig = new Map();

module.exports = {
  async get(key) {
    try {
      const res = await db.query('SELECT value FROM configuracion WHERE key = $1', [key]);
      if (res.rows[0]) {
        const raw = res.rows[0].value;
        return ENCRYPTED_KEYS.has(key) ? decrypt(raw) : raw;
      }
      return inMemoryConfig.has(key) ? inMemoryConfig.get(key) : (DEFAULTS[key] || null);
    } catch (_err) {
      logger.warn('ConfiguracionRepository get query failed, returning fallback', { key, error: _err.message });
      return inMemoryConfig.has(key) ? inMemoryConfig.get(key) : (DEFAULTS[key] || null);
    }
  },

  async set(key, value) {
    const valueToStore = ENCRYPTED_KEYS.has(key) ? encrypt(value) : value;
    inMemoryConfig.set(key, value);
    try {
      const res = await db.query(
        `INSERT INTO configuracion (key, value, updated_at) 
         VALUES ($1, $2, NOW()) 
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW() 
         RETURNING *`,
        [key, valueToStore]
      );
      return {
        ...res.rows[0],
        value, // Retornar el valor en plano a la capa llamadora
      };
    } catch (_err) {
      logger.warn('ConfiguracionRepository set query failed, returning transient value', { key, error: _err.message });
      return { key, value, updated_at: new Date().toISOString() };
    }
  },

  async getAll() {
    try {
      const res = await db.query('SELECT key, value, updated_at FROM configuracion');
      const result = { ...DEFAULTS };
      for (const row of res.rows) {
        result[row.key] = ENCRYPTED_KEYS.has(row.key) ? decrypt(row.value) : row.value;
      }
      return result;
    } catch (_err) {
      logger.warn('ConfiguracionRepository getAll query failed, returning defaults', { error: _err.message });
      const result = { ...DEFAULTS };
      for (const [k, v] of inMemoryConfig.entries()) {
        result[k] = v;
      }
      return result;
    }
  },
};
