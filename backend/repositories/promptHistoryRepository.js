const db = require('../config/db');

module.exports = {
  async addVersion(prompt, cambiadoPor = 'admin') {
    try {
      const countRes = await db.query('SELECT COUNT(*) FROM prompt_history');
      const version = parseInt(countRes.rows[0].count, 10) + 1;
      const res = await db.query(
        `INSERT INTO prompt_history (version, prompt, cambiado_por, created_at)
         VALUES ($1, $2, $3, NOW()) RETURNING *`,
        [version, prompt, cambiadoPor]
      );
      return res.rows[0];
    } catch (_err) {
      return null;
    }
  },

  async getHistory() {
    try {
      const res = await db.query('SELECT * FROM prompt_history ORDER BY version DESC LIMIT 20');
      return res.rows;
    } catch (_err) {
      return [];
    }
  },
};
