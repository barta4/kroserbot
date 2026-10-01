const db = require('../config/db');
const logger = require('../config/logger');

const PRODUCT_COLUMNS = 'id, sku, nombre, precio, precio_oferta, moneda, marca, categoria, descripcion, imagen_url, producto_url, stock_status';

module.exports = {
  // ──────────────────────────────────── Hybrid Search: Exact by SKU/code
  async searchExact(code, limit = 3) {
    if (!code || typeof code !== 'string') return [];
    const cleaned = code.trim();
    if (!cleaned) return [];

    // 1. Try direct SKU match
    const sqlDirect = `
      SELECT ${PRODUCT_COLUMNS}
      FROM productos
      WHERE discontinuado = FALSE AND sku = $1
      LIMIT 1;
    `;
    const resDirect = await db.query(sqlDirect, [cleaned]);
    if (resDirect.rows.length > 0) {
      return resDirect.rows.map((r) => ({ ...r, _matchType: 'exact' }));
    }

    // 2. Try partial SKU match (ILIKE)
    const sqlPartial = `
      SELECT ${PRODUCT_COLUMNS}
      FROM productos
      WHERE discontinuado = FALSE AND sku ILIKE $1
      ORDER BY sku ASC
      LIMIT $2;
    `;
    const resPartial = await db.query(sqlPartial, [`%${cleaned}%`, limit]);
    if (resPartial.rows.length > 0) {
      return resPartial.rows.map((r) => ({ ...r, _matchType: 'exact' }));
    }

    return [];
  },

  // ──────────────────────────────────── Hybrid Search: Full Text Search (Spanish FTS)
  async searchFTS(tsQueryStr, limit = 10) {
    if (!tsQueryStr || typeof tsQueryStr !== 'string') return [];
    const cleaned = tsQueryStr.trim();
    if (!cleaned) return [];

    try {
      const sql = `
        SELECT ${PRODUCT_COLUMNS},
               ts_rank(search_vector, to_tsquery('spanish', $1)) AS _ftsRank
        FROM productos
        WHERE discontinuado = FALSE
          AND search_vector @@ to_tsquery('spanish', $1)
        ORDER BY _ftsRank DESC,
                 (CASE WHEN stock_status = 'in_stock' THEN 1 ELSE 0 END) DESC
        LIMIT $2;
      `;
      const res = await db.query(sql, [cleaned, limit]);
      return res.rows;
    } catch (err) {
      // FTS column may not exist yet (migration not run); graceful fallback
      logger.warn('[productosRepo] FTS search failed, column may not exist yet', { error: err.message });
      return [];
    }
  },

  // ──────────────────────────────────── Hybrid Search: Vector with optional pre-filters
  async searchVectorFiltered(vectorArray, filters = {}, limit = 5) {
    if (!vectorArray || vectorArray.length === 0) return [];
    const vectorStr = `[${vectorArray.join(',')}]`;

    const conditions = ['discontinuado = FALSE', 'embedding IS NOT NULL'];
    const params = [vectorStr];
    let paramIdx = 2;

    if (filters.marca) {
      conditions.push(`translate(lower(marca), 'áéíóúü', 'aeiouu') ILIKE $${paramIdx}`);
      params.push(`%${filters.marca}%`);
      paramIdx++;
    }
    if (filters.categoria) {
      conditions.push(`translate(lower(categoria), 'áéíóúü', 'aeiouu') ILIKE $${paramIdx}`);
      params.push(`%${filters.categoria}%`);
      paramIdx++;
    }
    if (filters.nombreContains) {
      conditions.push(`translate(lower(nombre), 'áéíóúü', 'aeiouu') ILIKE $${paramIdx}`);
      params.push(`%${filters.nombreContains}%`);
      paramIdx++;
    }

    params.push(limit);

    const sql = `
      SELECT ${PRODUCT_COLUMNS},
             1 - (embedding <=> $1::vector) AS similarity
      FROM productos
      WHERE ${conditions.join(' AND ')}
      ORDER BY embedding <=> $1::vector ASC
      LIMIT $${paramIdx};
    `;
    const res = await db.query(sql, params);
    return res.rows;
  },

  // ──────────────────────────────────── Original: Vector search (preserved for backward compat)
  async searchVector(vectorArray, limit = 5) {
    if (!vectorArray || vectorArray.length === 0) return [];
    const vectorStr = `[${vectorArray.join(',')}]`;
    const sql = `
      SELECT ${PRODUCT_COLUMNS},
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

    // 1. Try exact phrase match first (with accent normalization and scoring)
    const stripAccents = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const normalizedKw = stripAccents(cleanKeyword.toLowerCase());
    const q = `%${normalizedKw}%`;
    const sqlExact = `
      SELECT ${PRODUCT_COLUMNS}
      FROM productos
      WHERE discontinuado = FALSE 
        AND (translate(lower(nombre), 'áéíóúü', 'aeiouu') ILIKE $1
             OR translate(lower(categoria), 'áéíóúü', 'aeiouu') ILIKE $1
             OR translate(lower(marca), 'áéíóúü', 'aeiouu') ILIKE $1
             OR translate(lower(coalesce(descripcion, '')), 'áéíóúü', 'aeiouu') ILIKE $1)
      ORDER BY
        (CASE WHEN translate(lower(nombre), 'áéíóúü', 'aeiouu') ILIKE $1 THEN 5 ELSE 0 END
         + CASE WHEN translate(lower(marca), 'áéíóúü', 'aeiouu') ILIKE $1 THEN 4 ELSE 0 END
         + CASE WHEN translate(lower(categoria), 'áéíóúü', 'aeiouu') ILIKE $1 THEN 2 ELSE 0 END) DESC,
        (CASE WHEN stock_status = 'in_stock' THEN 1 ELSE 0 END) DESC,
        precio ASC
      LIMIT $2;
    `;
    const resExact = await db.query(sqlExact, [q, limit]);
    if (resExact.rows.length > 0) {
      return resExact.rows;
    }

    // 2. Tokenized multi-word search preserving technical measurements
    const STOPWORDS = new Set(['de', 'la', 'el', 'en', 'para', 'con', 'un', 'una', 'y', 'o', 'del', 'los', 'las', 'al', 'por', 'que', 'qué', 'se', 'es', 'son', 'tenes', 'tienen', 'hola', 'cuanto', 'cuánto', 'cuesta', 'precio', 'tienen', 'venden']);
    
    // Preserve fractional measurements (1/2, 3/4) and dimensions (8x50) before stripping
    const preserved = normalizedKw
      .replace(/(\d+)\/(\d+)/g, '$1FRAC$2')   // 1/2 → 1FRAC2
      .replace(/(\d+)\s*x\s*(\d+)/g, '$1DIM$2'); // 8x50 → 8DIM50

    const tokens = preserved
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9]/gi, ''))
      .map((t) => t.replace(/FRAC/g, '/').replace(/DIM/g, 'x'))
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t));

    if (tokens.length === 0) return [];

    // Construct ILIKE conditions and relevance score for each token with unaccented translation
    const conditions = tokens.map((_, i) => `(translate(lower(nombre), 'áéíóúü', 'aeiouu') ILIKE $${i + 1} OR translate(lower(categoria), 'áéíóúü', 'aeiouu') ILIKE $${i + 1} OR translate(lower(marca), 'áéíóúü', 'aeiouu') ILIKE $${i + 1} OR translate(lower(coalesce(descripcion, '')), 'áéíóúü', 'aeiouu') ILIKE $${i + 1})`).join(' OR ');
    const scoreClauses = tokens.map((_, i) => `(CASE WHEN translate(lower(nombre), 'áéíóúü', 'aeiouu') ILIKE $${i + 1} THEN 5 WHEN translate(lower(marca), 'áéíóúü', 'aeiouu') ILIKE $${i + 1} THEN 4 WHEN translate(lower(categoria), 'áéíóúü', 'aeiouu') ILIKE $${i + 1} THEN 2 WHEN translate(lower(coalesce(descripcion, '')), 'áéíóúü', 'aeiouu') ILIKE $${i + 1} THEN 1 ELSE 0 END)`).join(' + ');
    const params = tokens.map((t) => `%${t}%`);
    params.push(limit);

    const sqlTokens = `
      SELECT ${PRODUCT_COLUMNS}
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
    const params = categories.map((c) => `%${c}%`);
    params.push(parseInt(limit, 10) || 3);
    const sql = `
      SELECT id, sku, nombre, precio, precio_oferta, moneda, marca, categoria, descripcion, imagen_url, producto_url, stock_status
      FROM productos
      WHERE discontinuado = FALSE
        AND stock_status != 'out_of_stock'
        AND (${conditions})
      LIMIT $${params.length};
    `;
    const res = await db.query(sql, params);
    return res.rows;
  },
};
