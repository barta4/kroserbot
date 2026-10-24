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

function hasWordMatch(text, token) {
  if (!text || !token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s|[^a-zA-Z0-9áéíóúüñ])${escaped}($|\\s|[^a-zA-Z0-9áéíóúüñ])`, 'i').test(text);
}

function isSpecOrModifierToken(token) {
  const t = String(token || '').toLowerCase();
  return (
    /^\d+([x/]\d+)?(mm|cm|m|kg|w|v|l|bar|hp)?$/i.test(t) ||
    ['redonda', 'redondo', 'plana', 'plano', 'cuadrada', 'cuadrado', 'chico', 'chica', 'grande', 'largo', 'corta', 'corto', 'mini', 'fino', 'fina', 'grueso', 'gruesa'].includes(t)
  );
}

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
  SYNONYM_FULL: 75,

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

  // Attribute mismatch (the customer asked for a specific spec and the product differs)
  ATTR_MISMATCH: -100,

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

  // Helpers for matching tokens even when the catalog name is concatenated
  // (e.g. "TIJERACORTATUBOSPVCDE42MM...").
  const SHORT_TECH_TOKENS = new Set(['pvc', 'led', 'gas', 'abs', 'ppr', 'mdf', 'cfl', 'uv', 'hdpe']);
  const matchesToken = (text, token) => {
    if (!text || !token) return false;
    const t = String(token).toLowerCase();
    if (SHORT_TECH_TOKENS.has(t)) return text.includes(t);
    if (t.length <= 3) {
      const regex = new RegExp(`(?:^|\\s|[.,;()\\-_/])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s|[.,;()\\-_/])`, 'i');
      return regex.test(text);
    }
    // 4+ caracteres: substring para tolerar nombres sin espacios.
    return text.includes(t);
  };

  const matchesFull = (text, target) => {
    if (!text || !target) return false;
    if (target.length <= 4) {
      return matchesToken(text, target);
    }
    return text.includes(target);
  };

  const matchesPhrase = (text, phrase) => {
    if (!text || !phrase) return false;
    const tokens = normalizeQuery(phrase).split(/\s+/).filter(Boolean);
    return tokens.length > 0 && tokens.every((t) => matchesToken(text, t));
  };

  // ── 2. Text Score
  if (normalizedQuery) {
    const isSpecOrModifier = (t) =>
      /^\d+([x/]\d+)?(mm|cm|m|kg|w|v|l|bar|hp)?$/i.test(t) ||
      ['redonda', 'redondo', 'plana', 'plano', 'cuadrada', 'cuadrado', 'chico', 'chica', 'grande', 'largo', 'corta', 'corto', 'mini', 'fino', 'fina', 'grueso', 'gruesa'].includes(t.toLowerCase());

    const targetQuery = cleanQuery || normalizedQuery;
    const queryTokens = targetQuery.split(/\s+/).filter((t) => t.length >= 2);
    const substantiveQueryTokens = queryTokens.filter((t) => !isSpecOrModifier(t));

    // Full name match (using either raw normalized query or substantive query without stopwords)
    if (matchesFull(nombre, normalizedQuery) || (cleanQuery && matchesFull(nombre, cleanQuery))) {
      breakdown.text += WEIGHTS.TEXT_NOMBRE_FULL;
    } else {
      let tokenMatchCount = 0;
      let substantiveMatchCount = 0;

      for (const token of queryTokens) {
        const matchesName = hasWordMatch(nombre, token);
        const matchesDesc = hasWordMatch(descripcion, token);
        if (matchesName || matchesDesc) {
          tokenMatchCount++;
          if (!isSpecOrModifier(token)) {
            substantiveMatchCount++;
          }
        }
      }

      const hasSynonymMatch = Boolean(
        attrs.synonyms &&
        attrs.synonyms.some((syn) =>
          matchesPhrase(nombre, syn) || matchesPhrase(categoria, syn) || matchesPhrase(descripcion, syn)
        )
      );

      // If query had substantive noun/product tokens (e.g. "varilla"), but candidate product
      // only matched numbers (e.g. "16") or generic shape adjectives ("redonda"): disqualify!
      // (Unless a recognized Uruguayan synonym matched the product, e.g. "medio tanque" -> "parrilla")
      if (substantiveQueryTokens.length > 0 && substantiveMatchCount === 0 && !hasSynonymMatch) {
        breakdown.penalty += -100;
      } else if (options.strictQuery && substantiveQueryTokens.length > 0 && substantiveMatchCount < substantiveQueryTokens.length) {
        // Para candidatos encontrados por una variante (sinónimo), exigimos que
        // toda la variante coincida: evita que "base multiple" puntúe por "base".
        breakdown.penalty += -100;
      } else if (queryTokens.length > 0) {
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
    // Check synonym matches with token-wise matching (tolerates concatenated names)
    if (attrs.synonyms && attrs.synonyms.length > 0) {
      for (const syn of attrs.synonyms) {
        if (matchesPhrase(nombre, syn)) {
          breakdown.text += WEIGHTS.SYNONYM_FULL;
          break;
        } else if (matchesPhrase(categoria, syn)) {
          breakdown.text += WEIGHTS.TEXT_NOMBRE_PARTIAL;
          break;
        }
      }
    }
  }

  // ── 3. Vector Similarity Score
  const vectorThreshold = options.vectorThreshold || WEIGHTS.VECTOR_THRESHOLD;
  if (product.similarity !== undefined && product.similarity >= vectorThreshold) {
    const range = 1 - vectorThreshold;
    const scaled = (product.similarity - vectorThreshold) / range;
    breakdown.vector = Math.round(scaled * WEIGHTS.VECTOR_MAX);
  }

  // El sustantivo principal de la consulta debe aparecer (o un sinónimo válido).
  // Evita que un producto con "pvc" gane cuando el cliente pidió "caño pvc".
  if (normalizedQuery) {
    const coreTokens = stripStopwords(normalizedQuery).split(/\s+/).filter((t) => t.length >= 2 && !isSpecOrModifierToken(t));
    const primaryCore = (options.primaryCoreTokens && options.primaryCoreTokens[0]) || coreTokens[0];
    if (primaryCore) {
      const primaryMatches =
        matchesToken(nombre, primaryCore) ||
        matchesToken(descripcion, primaryCore) ||
        matchesToken(categoria, primaryCore);
      const synonymMatches = Boolean(
        attrs.synonyms &&
        attrs.synonyms.some((syn) =>
          matchesPhrase(nombre, syn) || matchesPhrase(categoria, syn) || matchesPhrase(descripcion, syn)
        )
      );
      const vectorMatches = product.similarity !== undefined && product.similarity >= vectorThreshold;
      if (!primaryMatches && !synonymMatches && !vectorMatches) {
        breakdown.penalty += -100;
      }
    }
  }

  // Bonus por cantidad de sustantivos núcleo de la consulta original que
  // aparecen en el producto. Hace que "pintura latex" gane a "pintura para pisos"
  // aunque ambas coincidan con la palabra "pintura".
  if (options.coreTokensForBonus && options.coreTokensForBonus.length > 0) {
    const matchedCore = options.coreTokensForBonus.filter(
      (t) =>
        matchesToken(nombre, t) ||
        matchesToken(descripcion, t) ||
        matchesToken(categoria, t)
    ).length;
    if (matchedCore > 0) breakdown.text += matchedCore * 8;
  }

  // ── 4. Attribute Match Score (bonus if it matches, penalty if it contradicts)
  const searchable = `${nombre} ${descripcion} ${marca} ${categoria}`;
  const compact = searchable.replace(/\s+/g, '');

  if (attrs.color) {
    if (searchable.includes(attrs.color)) {
      breakdown.attribute += WEIGHTS.ATTR_COLOR;
    } else if (!options.relaxAttributes) {
      breakdown.attribute += WEIGHTS.ATTR_MISMATCH;
    }
  }

  if (attrs.medida) {
    const medida = String(attrs.medida).replace(/\s+/g, '');
    if (compact.includes(medida)) {
      breakdown.attribute += WEIGHTS.ATTR_MEDIDA;
    } else if (!options.relaxAttributes) {
      breakdown.attribute += WEIGHTS.ATTR_MISMATCH;
    }
  }

  if (attrs.dimension) {
    const dimension = String(attrs.dimension).replace(/\s+/g, '');
    if (compact.includes(dimension)) {
      breakdown.attribute += WEIGHTS.ATTR_DIMENSION;
    } else if (!options.relaxAttributes) {
      breakdown.attribute += WEIGHTS.ATTR_MISMATCH;
    }
  }

  if (attrs.volumen) {
    const vol = String(attrs.volumen);
    const volMatches =
      compact.includes(`${vol}l`) ||
      compact.includes(`${vol}lt`) ||
      compact.includes(`${vol}litro`);
    if (volMatches) {
      breakdown.attribute += WEIGHTS.ATTR_VOLUMEN;
    } else if (!options.relaxAttributes) {
      breakdown.attribute += WEIGHTS.ATTR_MISMATCH;
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
    const potencia = String(attrs.potencia).replace(/\s+/g, '');
    if (compact.includes(potencia)) {
      breakdown.attribute += WEIGHTS.ATTR_POTENCIA;
    } else if (!options.relaxAttributes) {
      breakdown.attribute += WEIGHTS.ATTR_MISMATCH;
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
    } else if (attrs.categoriaHint === 'construccion') {
      const isPaintOrUnrelated =
        categoria.includes('pintura') ||
        categoria.includes('iluminacion') ||
        categoria.includes('climatizacion') ||
        categoria.includes('herramienta') ||
        categoria.includes('bazar');
      const hasExplicitPaintTerms = /\b(?:pintura|membrana|caucho|impermeabilizante|esmalte|latex|color)\b/i.test(normalizedQuery);
      const hasToolTerms = /\b(?:grapa|engrampadora|calibre|herramienta)\b/i.test(normalizedQuery);
      if (isPaintOrUnrelated && !hasExplicitPaintTerms && !hasToolTerms) {
        breakdown.penalty += -100;
      }
    }
  }

  // Business relevance (tiebreakers only, cannot override lack of text/vector relevance)
  const hasRelevance = breakdown.exact > 0 || breakdown.text > 0 || breakdown.vector > 0;
  if (!hasRelevance) {
    breakdown.business = 0;
    breakdown.attribute = 0;
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

  const coreTokensForBonus = stripStopwords(normalizedQ)
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !isSpecOrModifierToken(t))
    .slice(0, 4);
  const scoringOptions = { ...options, coreTokensForBonus, primaryCoreTokens: coreTokensForBonus };

  const hasSpecAttributes = ['color', 'medida', 'dimension', 'volumen', 'potencia'].some(
    (key) => attrs[key] !== undefined && attrs[key] !== null && attrs[key] !== ''
  );

  const scored = products.map((p) => {
    const primary = scoreProduct(p, normalizedQ, attrs, scoringOptions);
    if (p._matchedQuery && p._matchedType === 'synonym') {
      const altQ = normalizeQuery(p._matchedQuery);
      if (altQ && altQ !== normalizedQ) {
        const alt = scoreProduct(p, altQ, {}, { ...scoringOptions, strictQuery: true });
        if (alt._score > primary._score) {
          return {
            ...alt,
            _scoredQuery: p._matchedQuery,
            ...(hasSpecAttributes ? { _approximate: true } : {}),
          };
        }
      }
    }
    return primary;
  });

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
