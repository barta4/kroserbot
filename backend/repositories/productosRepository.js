const db = require('../config/db');

module.exports = {
  async searchVector(vectorArray, limit = 5) {
    if (!vectorArray || vectorArray.length === 0) return [];
    const vectorStr = `[${vectorArray.join(',')}]`;
    const sql = `
      SELECT id, sku, nombre, precio, precio_oferta, moneda, marca, categoria, descripcion, imagen_url, producto_url, stock_status,
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
    if (!keyword || typeof keyword !== 'string') return [];
    const cleanKeyword = keyword.trim();
    if (!cleanKeyword) return [];

    // 1. Try exact phrase match first
    const q = `%${cleanKeyword}%`;
    const sqlExact = `
      SELECT id, sku, nombre, precio, precio_oferta, moneda, marca, categoria, descripcion, imagen_url, producto_url, stock_status
      FROM productos
      WHERE discontinuado = FALSE 
        AND (nombre ILIKE $1 OR categoria ILIKE $1 OR marca ILIKE $1 OR descripcion ILIKE $1)
      LIMIT $2;
    `;
    const resExact = await db.query(sqlExact, [q, limit]);
    if (resExact.rows.length > 0) {
      return resExact.rows;
    }

    // 2. Tokenized multi-word search for terms like "pala de pozo", "cinta métrica truper", "taladro 21v", etc.
    const STOPWORDS = new Set(['de', 'la', 'el', 'en', 'para', 'con', 'un', 'una', 'y', 'o', 'del', 'los', 'las', 'al', 'por', 'que', 'qué', 'se', 'es', 'son', 'tenes', 'tienen', 'hola', 'cuanto', 'cuánto', 'cuesta', 'precio', 'tienen', 'venden']);
    const stripAccents = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    const tokens = stripAccents(cleanKeyword.toLowerCase())
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9]/gi, ''))
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t));

    if (tokens.length === 0) return [];

    // Construct ILIKE conditions and relevance score for each token with unaccented translation
    const conditions = tokens.map((_, i) => `(translate(lower(nombre), 'áéíóúü', 'aeiouu') ILIKE $${i + 1} OR translate(lower(categoria), 'áéíóúü', 'aeiouu') ILIKE $${i + 1} OR translate(lower(marca), 'áéíóúü', 'aeiouu') ILIKE $${i + 1})`).join(' OR ');
    const scoreClauses = tokens.map((_, i) => `(CASE WHEN translate(lower(nombre), 'áéíóúü', 'aeiouu') ILIKE $${i + 1} THEN 5 WHEN translate(lower(marca), 'áéíóúü', 'aeiouu') ILIKE $${i + 1} THEN 4 WHEN translate(lower(categoria), 'áéíóúü', 'aeiouu') ILIKE $${i + 1} THEN 2 ELSE 0 END)`).join(' + ');
    const params = tokens.map((t) => `%${t}%`);
    params.push(limit);

    const sqlTokens = `
      SELECT id, sku, nombre, precio, precio_oferta, moneda, marca, categoria, descripcion, imagen_url, producto_url, stock_status
      FROM productos
      WHERE discontinuado = FALSE AND (${conditions})
      ORDER BY 
        (${scoreClauses}) DESC,
        (CASE WHEN stock_status = 'in_stock' THEN 1 ELSE 0 END) DESC,
        precio ASC
      LIMIT $${params.length};
    `;

    const resTokens = await db.query(sqlTokens, params);
    return resTokens.rows;
  },

  async getBySku(sku) {
    const res = await db.query('SELECT * FROM productos WHERE sku = $1', [sku]);
    return res.rows[0] || null;
  },

  async getAlternatives({ categoria, marca, excludeSku, limit = 3 }) {
    const sql = `
      SELECT id, sku, nombre, precio, precio_oferta, moneda, marca, categoria, descripcion, imagen_url, producto_url, stock_status
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
      SELECT id, sku, nombre, precio, precio_oferta, moneda, marca, categoria, descripcion, imagen_url, producto_url, stock_status
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
