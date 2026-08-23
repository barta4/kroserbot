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

  async getAlternatives({ categoria, marca, excludeSku, limit = 3 }) {
    const sql = `
      SELECT id, sku, nombre, precio, precio_oferta, marca, categoria, descripcion, stock_status
      FROM productos
      WHERE discontinuado = FALSE
        AND stock_status != 'out_of_stock'
        AND sku != $1
        AND (categoria ILIKE $2 OR marca ILIKE $3)
      LIMIT $4;
    `;
    const cat = categoria ? `%${categoria}%` : '___NONE___';
    const mar = marca ? `%${marca}%` : '___NONE___';
    const res = await db.query(sql, [excludeSku || '', cat, mar, limit]);
    return res.rows;
  },

  async getComplementaryItems(categories = [], limit = 3) {
    if (!categories || categories.length === 0) return [];
    const conditions = categories.map((_, i) => `categoria ILIKE $${i + 1} OR nombre ILIKE $${i + 1}`).join(' OR ');
    const sql = `
      SELECT id, sku, nombre, precio, precio_oferta, marca, categoria, stock_status
      FROM productos
      WHERE discontinuado = FALSE
        AND stock_status != 'out_of_stock'
        AND (${conditions})
      LIMIT ${limit};
    `;
    const params = categories.map((c) => `%${c}%`);
    const res = await db.query(sql, params);
    return res.rows;
  },
};
