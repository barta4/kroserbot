const db = require('../config/db');

const DEFAULTS = {
  system_prompt: 'Sos el asistente virtual de Kroser Uruguay. Tu objetivo es ayudar a los clientes a encontrar productos del catálogo, responder consultas sobre sucursales, precios y envíos, y asistir en la toma de pedidos.',
  msg_pedido_pendiente: 'Tu pedido pasó a revisión humana, en breve te confirmamos.',
  msg_pedido_listo: '¡Tu pedido fue confirmado! Te contactamos para coordinar la entrega.',
  msg_pedido_rechazado: 'Lamentamos informarte que no pudimos procesar tu pedido. Un asesor te contactará.',
  msg_derivacion: 'Te estoy derivando con un asesor humano que va a poder ayudarte mejor.',
};

module.exports = {
  async get(key) {
    try {
      const res = await db.query('SELECT value FROM configuracion WHERE key = $1', [key]);
      return res.rows[0] ? res.rows[0].value : DEFAULTS[key] || null;
    } catch (_err) {
      return DEFAULTS[key] || null;
    }
  },

  async set(key, value) {
    try {
      const res = await db.query(
        `INSERT INTO configuracion (key, value, updated_at) 
         VALUES ($1, $2, NOW()) 
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW() 
         RETURNING *`,
        [key, value]
      );
      DEFAULTS[key] = value;
      return res.rows[0];
    } catch (_err) {
      DEFAULTS[key] = value;
      return { key, value, updated_at: new Date().toISOString() };
    }
  },

  async getAll() {
    try {
      const res = await db.query('SELECT key, value, updated_at FROM configuracion');
      const result = { ...DEFAULTS };
      for (const row of res.rows) {
        result[row.key] = row.value;
      }
      return result;
    } catch (_err) {
      return DEFAULTS;
    }
  },
};
