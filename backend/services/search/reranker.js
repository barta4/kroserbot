/**
 * Re-ranker for Kroserbot Hybrid Search
 *
 * Combines scores from multiple search sources into a unified ranking:
 * - Exact match bonus (code/SKU)
 * - Text match score (FTS rank, ILIKE token matches)
 * - Vector similarity score (pgvector cosine)
 * - Attribute match score (color, volume, measurement, brand, usage)
 * - Business score (stock, price, image availability)
 */

const { normalizeQuery, stripStopwords } = require('../../utils/queryAnalyzer');

// ──────────────────────────────────────────── Weight Configuration
const WEIGHTS = {
  // Exact match
  EXACT_SKU: 1000,

  // Text scores (prioritize substantive text relevance over commercial metadata)
  TEXT_NOMBRE_FULL: 60,
  TEXT_NOMBRE_PARTIAL: 35,
  TEXT_NOMBRE_TOKEN: 15,
  TEXT_MARCA: 30,
  TEXT_CATEGORIA: 20,
  TEXT_FTS_RANK: 20,

  // Vector similarity (scaled from [THRESHOLD..1] to [0..MAX])
  VECTOR_MAX: 50,
  VECTOR_THRESHOLD: 0.52,

  // Attribute bonuses
  ATTR_COLOR: 20,
  ATTR_MEDIDA: 20,
  ATTR_VOLUMEN: 20,
  ATTR_USO: 10,
  ATTR_MARCA: 10,
  ATTR_POTENCIA: 15,
  ATTR_DIMENSION: 20,

  // Business relevance (tiebreakers only, cannot override text mismatch)
  BIZ_IN_STOCK: 8,
  BIZ_HAS_PRICE: 4,
  BIZ_HAS_IMAGE: 2,

  // Coherence penalty (product from wrong category)
  CATEGORY_INCOHERENCE_PENALTY: -60,
};

/**
 * Score a single product against the query and extracted attributes.
 *
 * @param {Object} product - Product row from DB
 * @param {string} normalizedQuery - Normalized user query
 * @param {Object} attrs - Extracted attributes from queryAnalyzer
 * @param {Object} options - Optional scoring adjustments
 * @returns {Object} Product with _score and _breakdown attached
 */
function scoreProduct(product, normalizedQuery, attrs = {}, options = {}) {
  const breakdown = {
    exact: 0,
    text: 0,
    vector: 0,
    attribute: 0,
    business: 0,
    penalty: 0,
  };

  const nombre = normalizeQuery(product.nombre || '');
  const marca = normalizeQuery(product.marca || '');
  const categoria = normalizeQuery(product.categoria || '');
  const descripcion = normalizeQuery(product.descripcion || '');
  const cleanQuery = stripStopwords(normalizedQuery);

  // ── 1. Exact Match Bonus
  if (product._matchType === 'exact') {
    breakdown.exact = WEIGHTS.EXACT_SKU;
  }

  // ── 2. Text Score
  if (normalizedQuery) {
    // Full name match (using either raw normalized query or substantive query without stopwords)
    if (nombre.includes(normalizedQuery) || (cleanQuery && nombre.includes(cleanQuery))) {
      breakdown.text += WEIGHTS.TEXT_NOMBRE_FULL;
    } else {
      // Token-level matching (isolated to substantive query tokens)
      const targetQuery = cleanQuery || normalizedQuery;
      const queryTokens = targetQuery.split(/\s+/).filter((t) => t.length >= 2);
      let tokenMatchCount = 0;
      for (const token of queryTokens) {
        if (nombre.includes(token) || descripcion.includes(token)) {
          tokenMatchCount++;
        }
      }
      if (queryTokens.length > 0) {
        const matchRatio = tokenMatchCount / queryTokens.length;
        if (matchRatio >= 0.95) {
          // All search tokens found in product name/description!
          breakdown.text += WEIGHTS.TEXT_NOMBRE_FULL;
        } else if (matchRatio >= 0.65) {
          breakdown.text += WEIGHTS.TEXT_NOMBRE_PARTIAL;
        } else if (tokenMatchCount > 0) {
          breakdown.text += Math.round(WEIGHTS.TEXT_NOMBRE_TOKEN * matchRatio * 2);
        }
      }
    }

    // Marca match from query text
    if (marca && normalizedQuery.includes(marca)) {
      breakdown.text += WEIGHTS.TEXT_MARCA;
    }

    // Categoría match from query text
    if (categoria && normalizedQuery.includes(categoria)) {
      breakdown.text += WEIGHTS.TEXT_CATEGORIA;
    }

    // FTS rank if available
    if (product._ftsRank && product._ftsRank > 0) {
      // ts_rank typically returns values from 0 to ~0.3; normalize to [0..1]
      const normalizedRank = Math.min(product._ftsRank / 0.3, 1);
      breakdown.text += Math.round(normalizedRank * WEIGHTS.TEXT_FTS_RANK);
    }
    // Check synonym matches with whole-word regex (prevents 'asador' matching 'engrasadora')
    if (attrs.synonyms && attrs.synonyms.length > 0) {
      for (const syn of attrs.synonyms) {
        const synPattern = new RegExp(`\\b${syn}\\b`, 'i');
        if (synPattern.test(nombre)) {
          breakdown.text += WEIGHTS.TEXT_NOMBRE_FULL;
          break;
        } else if (synPattern.test(categoria)) {
          breakdown.text += WEIGHTS.TEXT_NOMBRE_PARTIAL;
          break;
        }
      }
    }
  }

  // ── 3. Vector Similarity Score
  if (product.similarity !== undefined && product.similarity >= WEIGHTS.VECTOR_THRESHOLD) {
    const range = 1 - WEIGHTS.VECTOR_THRESHOLD;
    const scaled = (product.similarity - WEIGHTS.VECTOR_THRESHOLD) / range;
    breakdown.vector = Math.round(scaled * WEIGHTS.VECTOR_MAX);
  }

  // ── 4. Attribute Match Score
  const searchable = `${nombre} ${descripcion} ${marca} ${categoria}`;

  if (attrs.color) {
    if (searchable.includes(attrs.color)) {
      breakdown.attribute += WEIGHTS.ATTR_COLOR;
    }
  }

  if (attrs.medida) {
    // Need to check for fractional measurements (e.g., "1/2")
    if (searchable.includes(attrs.medida)) {
      breakdown.attribute += WEIGHTS.ATTR_MEDIDA;
    }
  }

  if (attrs.dimension) {
    if (searchable.includes(attrs.dimension)) {
      breakdown.attribute += WEIGHTS.ATTR_DIMENSION;
    }
  }

  if (attrs.volumen) {
    // Check for "20l", "20 litros", "20 lts", etc.
    const volPatterns = [
      `${attrs.volumen}l`,
      `${attrs.volumen} l`,
      `${attrs.volumen} litro`,
      `${attrs.volumen} lt`,
      `${attrs.volumen}lt`,
      `${attrs.volumen}lts`,
    ];
    if (volPatterns.some((p) => searchable.includes(p))) {
      breakdown.attribute += WEIGHTS.ATTR_VOLUMEN;
    }
  }

  if (attrs.uso) {
    if (searchable.includes(attrs.uso)) {
      breakdown.attribute += WEIGHTS.ATTR_USO;
    }
  }

  if (attrs.superficie) {
    if (searchable.includes(attrs.superficie)) {
      breakdown.attribute += WEIGHTS.ATTR_USO;
    }
  }

  if (attrs.marca) {
    const attrMarca = normalizeQuery(attrs.marca);
    if (marca.includes(attrMarca) || nombre.includes(attrMarca)) {
      breakdown.attribute += WEIGHTS.ATTR_MARCA;
    }
  }

  if (attrs.potencia) {
    if (searchable.includes(attrs.potencia)) {
      breakdown.attribute += WEIGHTS.ATTR_POTENCIA;
    }
  }

  // ── 5. Business Score
  if (product.stock_status === 'in_stock') {
    breakdown.business += WEIGHTS.BIZ_IN_STOCK;
  }
  if (product.precio && parseFloat(product.precio) > 0) {
    breakdown.business += WEIGHTS.BIZ_HAS_PRICE;
  }
  if (product.imagen_url) {
    breakdown.business += WEIGHTS.BIZ_HAS_IMAGE;
  }

  // ── 6. Category Coherence Penalty
  if (attrs.categoriaHint) {
    if (attrs.categoriaHint === 'pintura') {
      const isToolProduct = categoria.includes('herramienta') && !nombre.includes('pincel') && !nombre.includes('rodillo') && !nombre.includes('espatula') && !nombre.includes('bandeja') && !nombre.includes('pintar');
      const isUnrelatedCategory =
        nombre.includes('ventilador') ||
        nombre.includes('plafon') ||
        nombre.includes('lampara') ||
        nombre.includes('foco') ||
        nombre.includes('estufa') ||
        nombre.includes('caloventor') ||
        categoria.includes('ventilacion') ||
        categoria.includes('iluminacion') ||
        categoria.includes('climatizacion') ||
        categoria.includes('electricidad') ||
        categoria.includes('sanitaria') ||
        categoria.includes('bazar') ||
        categoria.includes('electro');
      if (isToolProduct || isUnrelatedCategory) {
        breakdown.penalty += WEIGHTS.CATEGORY_INCOHERENCE_PENALTY;
      }
    } else if (attrs.categoriaHint === 'hidrolavadoras') {
      // If customer asks for pressure washers, aspiradoras or unpowered tools get penalized
      const isAspiradoraOrUnrelated = (nombre.includes('aspiradora') && !nombre.includes('hidrolavadora')) || categoria.includes('climatizacion') || categoria.includes('iluminacion') || categoria.includes('pintura');
      if (isAspiradoraOrUnrelated) {
        breakdown.penalty += WEIGHTS.CATEGORY_INCOHERENCE_PENALTY;
      }
    } else if (attrs.categoriaHint === 'parrillas') {
      const isToolOrAccProduct = categoria.includes('herramienta') || categoria.includes('fijacion') || categoria.includes('abrasivo') || categoria.includes('accesorio') || categoria.includes('iluminacion') || nombre.includes('mecha') || nombre.includes('broca') || nombre.includes('tarugo') || nombre.includes('tornillo') || nombre.includes('engrasadora');
      const isBaseOrStand = nombre.startsWith('base para') || nombre.startsWith('soporte para') || nombre.startsWith('funda para');
      if (isToolOrAccProduct || isBaseOrStand) {
        breakdown.penalty += WEIGHTS.CATEGORY_INCOHERENCE_PENALTY;
      }
    } else if (attrs.categoriaHint === 'sanitaria') {
      const isGasOrMask = nombre.includes('gas') || nombre.includes('garrafa') || nombre.includes('mascarilla') || nombre.includes('respirador') || categoria.includes('gas') || categoria.includes('pintura') || categoria.includes('iluminacion') || categoria.includes('climatizacion');
      if (isGasOrMask) {
        breakdown.penalty += WEIGHTS.CATEGORY_INCOHERENCE_PENALTY;
      }
    } else if (attrs.categoriaHint === 'herramientas') {
      const isUnrelated = categoria.includes('iluminacion') || categoria.includes('pintura') || categoria.includes('climatizacion') || categoria.includes('bazar');
      if (isUnrelated) {
        breakdown.penalty += WEIGHTS.CATEGORY_INCOHERENCE_PENALTY;
      }
    } else if (attrs.categoriaHint === 'iluminacion') {
      const isUnrelated = categoria.includes('pintura') || categoria.includes('sanitaria') || categoria.includes('herramienta') || categoria.includes('jardin');
      if (isUnrelated) {
        breakdown.penalty += WEIGHTS.CATEGORY_INCOHERENCE_PENALTY;
      }
    }
  }

  // ── Total
  const totalScore =
    breakdown.exact +
    breakdown.text +
    breakdown.vector +
    breakdown.attribute +
    breakdown.business +
    breakdown.penalty;

  return {
    ...product,
    _score: totalScore,
    _breakdown: breakdown,
  };
}

/**
 * Re-rank a list of products using the combined scoring formula.
 *
 * @param {Object[]} products - Array of product objects from search
 * @param {string} rawQuery - Original user query
 * @param {Object} attrs - Extracted attributes from queryAnalyzer
 * @returns {Object[]} Products sorted by _score descending
 */
function rerank(products, rawQuery, attrs = {}, options = {}) {
  if (!products || products.length === 0) return [];

  const normalizedQ = normalizeQuery(rawQuery);

  const scored = products.map((p) => scoreProduct(p, normalizedQ, attrs, options));

  // Sort by score descending, then by stock (in_stock first), then by normalized price
  scored.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    // Tiebreaker: in_stock first
    const stockA = a.stock_status === 'in_stock' ? 1 : 0;
    const stockB = b.stock_status === 'in_stock' ? 1 : 0;
    if (stockB !== stockA) return stockB - stockA;
    // Tiebreaker: lower price (currency-aware: convert USD to UYU approx so U$S 392 is not considered cheaper than $6200 UYU)
    const normPrice = (p) => {
      const num = parseFloat(p.precio) || Infinity;
      if (num === Infinity) return num;
      if (p.moneda === 'USD' || p.moneda === 'U$S') return num * (options.exchangeRate || 42);
      return num;
    };
    const priceA = normPrice(a);
    const priceB = normPrice(b);
    return priceA - priceB;
  });

  return scored;
}

module.exports = {
  scoreProduct,
  rerank,
  WEIGHTS,
};
