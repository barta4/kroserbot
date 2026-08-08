const db = require('../config/db');

module.exports = {
  async searchVector(vectorArray, limit = 5) {
    if (!vectorArray || vectorArray.length === 0) return [];
    const vectorStr = `[${vectorArray.join(',')}]`;
    const sql = `
      SELECT id, sku, nombre, precio, precio_oferta, marca, categoria, descripcion, imagen_url, producto_url, stock_status,
             1 - (embedding <=> $1::vector) AS similarity
      FROM productos
      WHERE discontinuado = FALSE AND embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector ASC
      LIMIT $2;
    `;
    const res = await db.query(sql, [vectorStr, limit]);
    return res.rows;
  },

  async searchByKeyword(keyword, limit = 5) {
    const q = `%${keyword}%`;
    const sql = `
      SELECT id, sku, nombre, precio, precio_oferta, marca, categoria, descripcion, imagen_url, producto_url, stock_status
      FROM productos
      WHERE discontinuado = FALSE 
        AND (nombre ILIKE $1 OR categoria ILIKE $1 OR marca ILIKE $1 OR descripcion ILIKE $1)
      LIMIT $2;
    `;
    const res = await db.query(sql, [q, limit]);
    return res.rows;
  },

  async getBySku(sku) {
    const res = await db.query('SELECT * FROM productos WHERE sku = $1', [sku]);
    return res.rows[0] || null;
  },
};
