const db = require('../config/db');
const logger = require('../config/logger');

module.exports = {
  async logMessage(conversation_id, mensaje, rol = 'user') {
    try {
      const res = await db.query(
        `INSERT INTO conversaciones (conversation_id, mensaje, rol, created_at)
         VALUES ($1, $2, $3, NOW()) RETURNING *`,
        [String(conversation_id), mensaje, rol]
      );
      return res.rows[0];
    } catch (err) {
      logger.warn('[ConversacionesLog Error]', { error: err.message });
    }
  },

  async getHistory(conversation_id, limit = 20) {
    try {
      const res = await db.query(
        `SELECT * FROM conversaciones 
         WHERE conversation_id = $1 
         ORDER BY created_at DESC LIMIT $2`,
        [String(conversation_id), limit]
      );
      return res.rows.reverse();
    } catch (err) {
      logger.warn('[ConversacionesGetHistory Error]', { error: err.message });
      return [];
    }
  },

  async getRecentTopics(conversation_id, limit = 5) {
    try {
      const res = await db.query(
        `SELECT mensaje FROM conversaciones 
         WHERE conversation_id = $1 AND rol = 'user'
         ORDER BY created_at DESC LIMIT $2`,
        [String(conversation_id), limit]
      );
      return res.rows.map((r) => r.mensaje);
    } catch (_err) {
      return [];
    }
  },
};
