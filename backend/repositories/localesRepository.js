const db = require('../config/db');

module.exports = {
  async getAll() {
    const res = await db.query('SELECT * FROM locales ORDER BY id ASC');
    return res.rows;
  },

  async getById(id) {
    const res = await db.query('SELECT * FROM locales WHERE id = $1', [id]);
    return res.rows[0] || null;
  },

  async search(queryText) {
    const q = `%${queryText}%`;
    const res = await db.query(
      `SELECT * FROM locales 
       WHERE nombre ILIKE $1 OR zona ILIKE $1 OR direccion ILIKE $1`,
      [q]
    );
    return res.rows;
  },
};
