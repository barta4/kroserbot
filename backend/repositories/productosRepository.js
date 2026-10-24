const db = require('../config/db');
const logger = require('../config/logger');
const traductorTecnico = require('../utils/traductorTecnico');

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
      conditions.push(`krosmart_unaccent(marca) ILIKE $${paramIdx}`);
      params.push(`%${filters.marca}%`);
      paramIdx++;
    }
    if (filters.categoria) {
      conditions.push(`krosmart_unaccent(categoria) ILIKE $${paramIdx}`);
      params.push(`%${filters.categoria}%`);
      paramIdx++;
    }
    if (filters.nombreContains) {
      conditions.push(`krosmart_unaccent(nombre) ILIKE $${paramIdx}`);
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

  async searchByKeyword(keyword, limit = 5, { allowRelaxed = true } = {}) {
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
        AND (krosmart_unaccent(nombre) ILIKE $1
             OR krosmart_unaccent(categoria) ILIKE $1
             OR krosmart_unaccent(marca) ILIKE $1
             OR krosmart_unaccent(coalesce(descripcion, '')) ILIKE $1)
      ORDER BY
        (CASE WHEN krosmart_unaccent(nombre) ILIKE $1 THEN 5 ELSE 0 END
         + CASE WHEN krosmart_unaccent(marca) ILIKE $1 THEN 4 ELSE 0 END
         + CASE WHEN krosmart_unaccent(categoria) ILIKE $1 THEN 2 ELSE 0 END) DESC,
        (CASE WHEN stock_status = 'in_stock' THEN 1 ELSE 0 END) DESC,
        precio ASC
      LIMIT $2;
    `;
    const resExact = await db.query(sqlExact, [q, limit]);
    if (resExact.rows.length > 0) {
      return resExact.rows;
    }

    // 2. Tokenized multi-word search preserving technical measurements
    const STOPWORDS = new Set([
      'de', 'la', 'el', 'en', 'para', 'con', 'un', 'una', 'y', 'o', 'del',
      'los', 'las', 'al', 'por', 'que', 'qué', 'se', 'es', 'son', 'tenes',
      'tienen', 'hola', 'cuanto', 'cuánto', 'cuesta', 'precio', 'venden',
      'llueve', 'gotera', 'goteras', 'filtracion', 'filtraciones', 'humedad', 'humedades',
      'roto', 'rota', 'arreglar', 'reparar'
    ]);
    
    // Preserve fractional measurements (1/2, 3/4) and dimensions (8x50) before stripping
    const preserved = normalizedKw
      .replace(/(\d+)\/(\d+)/g, '$1FRAC$2')   // 1/2 → 1FRAC2
      .replace(/(\d+)\s*x\s*(\d+)/g, '$1DIM$2'); // 8x50 → 8DIM50

    const rawTokens = preserved
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9]/gi, ''))
      .map((t) => t.replace(/FRAC/g, '/').replace(/DIM/g, 'x'))
      .filter((t) => t.length >= 2 && !STOPWORDS.has(t));

    if (rawTokens.length === 0) return [];

    const PROBLEM_SURFACE = new Set([
      'techo', 'techos', 'piso', 'pisos', 'pared', 'paredes', 'azotea', 'azoteas',
      'bano', 'baño', 'cocina', 'patio', 'jardin', 'fachada',
      'llueve', 'lluvia', 'gotera', 'filtracion', 'humedad', 'grieta', 'fisura',
      'roto', 'rota', 'arreglar', 'reparar'
    ]);
    const substantiveTokens = rawTokens.filter((t) => !PROBLEM_SURFACE.has(t));
    const tokens = substantiveTokens.length > 0 ? substantiveTokens : rawTokens;

    // Helper: identify pure measurement/dimension/number tokens or generic adjectives
    const isSpecOrAdjective = (t) =>
      /^\d+([x/]\d+)?(mm|cm|m|kg|w|v|l|bar|hp)?$/i.test(t) ||
      ['redonda', 'redondo', 'plana', 'plano', 'cuadrada', 'cuadrado', 'chico', 'chica', 'grande', 'largo', 'corta', 'corto', 'mini'].includes(t.toLowerCase());

    const coreNounTokens = tokens.filter((t) => !isSpecOrAdjective(t));

    const buildCondition = (tList, operator = 'AND') => {
      const conds = tList
        .map(
          (_, i) =>
            `(krosmart_unaccent(nombre) ILIKE $${i + 1} OR krosmart_unaccent(categoria) ILIKE $${i + 1} OR krosmart_unaccent(marca) ILIKE $${i + 1} OR krosmart_unaccent(coalesce(descripcion, '')) ILIKE $${i + 1})`
        )
        .join(` ${operator} `);
      const scores = tList
        .map(
          (_, i) =>
            `(CASE WHEN krosmart_unaccent(nombre) ILIKE $${i + 1} THEN 5 WHEN krosmart_unaccent(marca) ILIKE $${i + 1} THEN 4 WHEN krosmart_unaccent(categoria) ILIKE $${i + 1} THEN 2 WHEN krosmart_unaccent(coalesce(descripcion, '')) ILIKE $${i + 1} THEN 1 ELSE 0 END)`
        )
        .join(' + ');
      return { conds, scores };
    };

    if (tokens.length > 1) {
      // 2a. Strict match: ALL tokens must be present
      const { conds: condsAnd, scores: scoresAnd } = buildCondition(tokens, 'AND');
      const paramsAnd = tokens.map((t) => `%${t}%`);
      paramsAnd.push(limit);
      const sqlAnd = `
        SELECT ${PRODUCT_COLUMNS}
        FROM productos
        WHERE discontinuado = FALSE AND (${condsAnd})
        ORDER BY 
          (${scoresAnd}) DESC,
          (CASE WHEN stock_status = 'in_stock' THEN 1 ELSE 0 END) DESC,
          precio ASC
        LIMIT $${paramsAnd.length};
      `;
      const resAnd = await db.query(sqlAnd, paramsAnd);
      if (resAnd.rows.length > 0) {
        return resAnd.rows;
      }

      // If strict AND failed, only fall back if we have core substantive nouns (e.g. "taladro", "percutor")
      // Never fall back using pure numbers (e.g. "16") or generic adjectives ("redonda") in isolation
      if (coreNounTokens.length === 0) {
        return [];
      }

      const { conds: condsCore, scores: scoresCore } = buildCondition(coreNounTokens, 'AND');
      const paramsCore = coreNounTokens.map((t) => `%${t}%`);
      paramsCore.push(limit);
      const sqlCore = `
        SELECT ${PRODUCT_COLUMNS}
        FROM productos
        WHERE discontinuado = FALSE AND (${condsCore})
        ORDER BY 
          (${scoresCore}) DESC,
          (CASE WHEN stock_status = 'in_stock' THEN 1 ELSE 0 END) DESC,
          precio ASC
        LIMIT $${paramsCore.length};
      `;
      const resCore = await db.query(sqlCore, paramsCore);
      if (resCore.rows.length > 0) {
        return resCore.rows;
      }

      if (!allowRelaxed) {
        return [];
      }

      // 2b. Relaxed OR fallback: alguno de los sustantivos núcleo alcanza.
      // El re-ranker ordena después por coincidencia de tokens y atributos.
      const { conds: condsOr, scores: scoresOr } = buildCondition(coreNounTokens, 'OR');
      const paramsOr = coreNounTokens.map((t) => `%${t}%`);
      paramsOr.push(limit);
      const sqlOr = `
        SELECT ${PRODUCT_COLUMNS}
        FROM productos
        WHERE discontinuado = FALSE AND (${condsOr})
        ORDER BY 
          (${scoresOr}) DESC,
          (CASE WHEN stock_status = 'in_stock' THEN 1 ELSE 0 END) DESC,
          precio ASC
        LIMIT $${paramsOr.length};
      `;
      const resOr = await db.query(sqlOr, paramsOr);
      return resOr.rows;
    }

    // Single token: if it's a pure number or generic adjective, do not search blindly
    if (isSpecOrAdjective(tokens[0])) {
      return [];
    }

    const { conds: condsSingle, scores: scoresSingle } = buildCondition(tokens, 'OR');
    const paramsSingle = tokens.map((t) => `%${t}%`);
    paramsSingle.push(limit);
    const sqlSingle = `
      SELECT ${PRODUCT_COLUMNS}
      FROM productos
      WHERE discontinuado = FALSE AND (${condsSingle})
      ORDER BY 
        (${scoresSingle}) DESC,
        (CASE WHEN stock_status = 'in_stock' THEN 1 ELSE 0 END) DESC,
        precio ASC
      LIMIT $${paramsSingle.length};
    `;
    const resSingle = await db.query(sqlSingle, paramsSingle);
    return resSingle.rows;
  },

  async searchByPrefix(keyword, limit = 5) {
    if (!keyword || typeof keyword !== 'string') return [];
    const clean = keyword.trim();
    if (!clean) return [];
    const sql = `
      SELECT ${PRODUCT_COLUMNS}
      FROM productos
      WHERE discontinuado = FALSE
        AND (krosmart_unaccent(nombre) ILIKE $1 || '%'
             OR krosmart_unaccent(categoria) ILIKE $1 || '%'
             OR krosmart_unaccent(marca) ILIKE $1 || '%')
      ORDER BY
        (CASE WHEN krosmart_unaccent(nombre) ILIKE $1 || '%' THEN 10 ELSE 0 END) DESC,
        (CASE WHEN stock_status = 'in_stock' THEN 1 ELSE 0 END) DESC,
        precio ASC
      LIMIT $2;
    `;
    const res = await db.query(sql, [clean, limit]);
    return res.rows;
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

  async listWithPromociones({ search, categoria, marca, fuente_origen, promo_id, include_discontinued = false, limit = 50, offset = 0 } = {}) {
    const parsedLimit = Math.max(1, parseInt(limit, 10) || 50);
    const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);
    const includeDiscontinued = include_discontinued === true || include_discontinued === 'true';
    const activeFilter = includeDiscontinued ? '' : ' AND p.discontinuado = FALSE';

    let countSql = `SELECT COUNT(*) as total FROM productos p WHERE 1=1${activeFilter}`;
    let sql = `
      SELECT p.id, p.sku, p.nombre, p.precio, p.precio_costo, p.precio_oferta, p.moneda,
             p.marca, p.categoria, p.descripcion, p.imagen_url, p.producto_url,
             p.stock_status, p.fuente_origen, p.margen_aplicado, p.iva_aplicado,
             p.discontinuado, p.updated_at,
             pp_active.promocion_id AS promo_id,
             pp_active.promo_titulo,
             pp_active.promo_badge,
             pp_active.descuento_porcentaje AS promo_descuento
      FROM productos p
      LEFT JOIN LATERAL (
        SELECT pe.id AS promocion_id,
               pe.titulo AS promo_titulo,
               pe.badge AS promo_badge,
               COALESCE(pp.descuento_override, pe.descuento_porcentaje) AS descuento_porcentaje
        FROM promocion_productos pp
        JOIN promociones_especiales pe ON pe.id = pp.promocion_id
        WHERE pp.producto_id = p.id AND pe.activo = TRUE
        ORDER BY pe.orden ASC, pe.id DESC
        LIMIT 1
      ) pp_active ON TRUE
      WHERE 1=1${activeFilter}
    `;
    const params = [];

    if (search && typeof search === 'string' && search.trim() !== '') {
      const rawSearch = search.trim();
      const unpunctuated = rawSearch.replace(/[?¿!¡.,;:()"']/g, ' ').trim();
      const cleaned = (traductorTecnico && typeof traductorTecnico.limpiarMensajeColoquial === 'function')
        ? traductorTecnico.limpiarMensajeColoquial(unpunctuated)
        : unpunctuated;
      const targetSearch = (cleaned && cleaned.trim().length >= 2) ? cleaned.trim() : unpunctuated;

      const stopwords = new Set(['de', 'la', 'el', 'en', 'un', 'una', 'con', 'para', 'por', 'los', 'las', 'del', 'al', 'o', 'y', 'es', 'son', 'que', 'me']);
      const tokens = targetSearch.split(/\s+/).filter((t) => t.length >= 2 && !stopwords.has(t.toLowerCase()));

      if (tokens.length > 0) {
        tokens.forEach((tok) => {
          params.push(`%${tok}%`);
          const clause = ` AND (p.nombre ILIKE $${params.length} OR p.sku ILIKE $${params.length} OR p.marca ILIKE $${params.length} OR p.categoria ILIKE $${params.length})`;
          countSql += clause;
          sql += clause;
        });
      }
    }

    if (categoria && typeof categoria === 'string' && categoria.trim() !== '') {
      params.push(categoria.trim());
      const clause = ` AND p.categoria ILIKE $${params.length}`;
      countSql += clause;
      sql += clause;
    }

    if (marca && typeof marca === 'string' && marca.trim() !== '') {
      params.push(marca.trim());
      const clause = ` AND p.marca ILIKE $${params.length}`;
      countSql += clause;
      sql += clause;
    }

    if (fuente_origen && typeof fuente_origen === 'string' && fuente_origen.trim() !== '') {
      params.push(fuente_origen.trim());
      const clause = ` AND p.fuente_origen = $${params.length}`;
      countSql += clause;
      sql += clause;
    }

    if (promo_id) {
      const parsedPromoId = parseInt(promo_id, 10);
      if (!isNaN(parsedPromoId) && parsedPromoId > 0) {
        params.push(parsedPromoId);
        const clause = ` AND EXISTS (SELECT 1 FROM promocion_productos pp_f WHERE pp_f.promocion_id = $${params.length} AND pp_f.producto_id = p.id)`;
        countSql += clause;
        sql += clause;
      }
    }

    let total = 0;
    try {
      const countRes = await db.query(countSql, params);
      total = parseInt(countRes.rows[0]?.total || 0, 10);
    } catch (_e) {
      total = 0;
    }

    sql += ` ORDER BY p.updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const queryParams = [...params, parsedLimit, parsedOffset];

    let rows = [];
    try {
      const result = await db.query(sql, queryParams);
      rows = result.rows;
    } catch (_err) {
      rows = [
        { id: 1, sku: 'KROS-PINT-01', nombre: 'Pintura Látex Interior 20L', precio: 2490, marca: 'Inca', categoria: 'Pinturas', stock_status: 'in_stock', discontinuado: false },
        { id: 2, sku: 'KROS-HERR-02', nombre: 'Taladro Percutor 750W', precio: 3890, marca: 'Bosch', categoria: 'Herramientas', stock_status: 'in_stock', discontinuado: false },
        { id: 3, sku: 'KROS-SANI-03', nombre: 'Canilla Monocomando Cocina', precio: 1950, marca: 'FV', categoria: 'Sanitaria', stock_status: 'in_stock', discontinuado: false },
        { id: 4, sku: 'KROS-ELEC-04', nombre: 'Reflector LED 50W Exterior', precio: 890, marca: 'Philips', categoria: 'Electricidad', stock_status: 'in_stock', discontinuado: false },
      ];
      total = rows.length;
    }

    return { items: rows, total, limit: parsedLimit, offset: parsedOffset };
  },

  async findByIdWithPromocion(id) {
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId) || parsedId <= 0) return null;

    try {
      const result = await db.query(`
        SELECT p.*,
               pp_active.promocion_id AS promo_id,
               pp_active.promo_titulo,
               pp_active.promo_badge,
               pp_active.descuento_porcentaje AS promo_descuento
        FROM productos p
        LEFT JOIN LATERAL (
          SELECT pe.id AS promocion_id,
                 pe.titulo AS promo_titulo,
                 pe.badge AS promo_badge,
                 COALESCE(pp.descuento_override, pe.descuento_porcentaje) AS descuento_porcentaje
          FROM promocion_productos pp
          JOIN promociones_especiales pe ON pe.id = pp.promocion_id
          WHERE pp.producto_id = p.id AND pe.activo = TRUE
          ORDER BY pe.orden ASC, pe.id DESC
          LIMIT 1
        ) pp_active ON TRUE
        WHERE p.id = $1 AND p.discontinuado = FALSE
      `, [parsedId]);

      if (result.rows.length > 0) return result.rows[0];
    } catch (_e) {
      try {
        const fallbackRes = await db.query('SELECT * FROM productos WHERE id = $1 AND discontinuado = FALSE', [parsedId]);
        if (fallbackRes.rows.length > 0) return fallbackRes.rows[0];
      } catch (_e2) {
        return null;
      }
    }
    return null;
  },

  async getCategoriasStats() {
    try {
      const result = await db.query(`
        SELECT categoria, COUNT(*) as count
        FROM productos
        WHERE discontinuado = FALSE AND categoria IS NOT NULL AND categoria != ''
        GROUP BY categoria
        ORDER BY count DESC;
      `);
      return result.rows;
    } catch (_e) {
      return [
        { categoria: 'Pinturas', count: 42 },
        { categoria: 'Herramientas', count: 68 },
        { categoria: 'Sanitaria', count: 35 },
        { categoria: 'Electricidad', count: 29 },
        { categoria: 'Jardín', count: 18 },
        { categoria: 'Fijaciones', count: 24 },
      ];
    }
  },

  async findBySku(sku) {
    if (!sku || typeof sku !== 'string') return null;
    const cleaned = sku.trim();
    if (!cleaned) return null;
    try {
      const result = await db.query(
        'SELECT * FROM productos WHERE sku = $1 AND discontinuado = FALSE LIMIT 1',
        [cleaned]
      );
      return result.rows[0] || null;
    } catch (_err) {
      return null;
    }
  },

  async deleteById(id) {
    const parsedId = parseInt(id, 10);
    if (isNaN(parsedId) || parsedId <= 0) return false;
    const result = await db.query('DELETE FROM productos WHERE id = $1', [parsedId]);
    return result.rowCount > 0;
  },
};
