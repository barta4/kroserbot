const db = require('../config/db');
const { encrypt, decrypt } = require('../utils/cryptoUtils');

const DEFAULTS = Object.freeze({
  system_prompt: 'Sos el asistente virtual de Kroser Uruguay. Tu objetivo es ayudar a los clientes a encontrar productos del catálogo, responder consultas sobre sucursales, precios y envíos, y asistir en la toma de pedidos.',
  msg_pedido_pendiente: 'Tu pedido pasó a revisión humana, en breve te confirmamos.',
  msg_pedido_listo: '¡Tu pedido fue confirmado! Te contactamos para coordinar la entrega.',
  msg_pedido_rechazado: 'Lamentamos informarte que no pudimos procesar tu pedido. Un asesor te contactará.',
  msg_derivacion: 'Te estoy derivando con un asesor humano que va a poder ayudarte mejor.',
});

const ENCRYPTED_KEYS = new Set([
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
  async get(key) {
    try {
      const res = await db.query('SELECT value FROM configuracion WHERE key = $1', [key]);
      if (res.rows[0]) {
        const raw = res.rows[0].value;
        return ENCRYPTED_KEYS.has(key) ? decrypt(raw) : raw;
      }
      return DEFAULTS[key] || null;
    } catch (_err) {
      return DEFAULTS[key] || null;
    }
  },

  async set(key, value) {
    const valueToStore = ENCRYPTED_KEYS.has(key) ? encrypt(value) : value;
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
      return { ...DEFAULTS };
    }
  },
};
