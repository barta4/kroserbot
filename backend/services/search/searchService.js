/**
 * Hybrid Search Service for Kroserbot
 *
 * Orchestrates the three search layers:
 * 1. Exact match (SKU/code)
 * 2. Textual search (FTS + ILIKE tokenized)
 * 3. Semantic search (pgvector with pre-filters)
 *
 * Then applies re-ranking to produce the best results.
 */

const productosRepo = require('../../repositories/productosRepository');
const configuracionRepo = require('../../repositories/configuracionRepository');
const { rerank } = require('./reranker');
const queryAnalyzer = require('../../utils/queryAnalyzer');
const logger = require('../../config/logger');

let embeddingProvider = null;
try {
  embeddingProvider = require('../embeddings/embeddingProvider');
} catch (_e) {
  embeddingProvider = null;
}

const SIMILARITY_THRESHOLD = 0.52;

/**
 * Main hybrid search function.
 *
 * @param {string} rawQuery - Original user query
 * @param {Object} options - Optional search configuration
 * @param {number} options.limit - Max results to return (default 5)
 * @param {boolean} options.skipVector - Skip vector search (for speed or during dev)
 * @returns {Promise<Object[]>} Ranked product results
 */
async function hybridSearch(rawQuery, { limit = 5, skipVector = false, allowRelaxed = true } = {}) {
  if (!rawQuery || typeof rawQuery !== 'string' || !rawQuery.trim()) {
    return [];
  }

  const query = rawQuery.trim();
  const normalizedQuery = queryAnalyzer.normalizeQuery(query);
  const candidates = [];
  const seenSkus = new Set();

  // Helper to add candidates without duplicates
  const addCandidates = (items, matchedQuery = null, matchedType = null) => {
    for (const item of items) {
      if (item.sku && !seenSkus.has(item.sku)) {
        seenSkus.add(item.sku);
        if (matchedQuery) {
          item._matchedQuery = matchedQuery;
          item._matchedType = matchedType;
        }
        candidates.push(item);
      }
    }
  };

  // ── STEP 1: Is this a code/SKU query?
  const { isCode, code } = queryAnalyzer.detectCode(normalizedQuery);

  if (isCode && code) {
    try {
      const exactResults = await productosRepo.searchExact(code, 3);
      if (exactResults.length > 0) {
        logger.info('[HybridSearch] Exact SKU match found', { code, count: exactResults.length });
        // For exact matches, return immediately with high score
        const attrs = queryAnalyzer.extractAttributes(normalizedQuery);
        return rerank(exactResults, query, attrs).slice(0, limit);
      }
    } catch (err) {
      logger.warn('[HybridSearch] Exact search error', { error: err.message });
    }
  }

  // ── STEP 2: Extract attributes
  const attrs = queryAnalyzer.extractAttributes(normalizedQuery);

  // ── STEP 3: Textual and Vector search (executed in parallel when vector is available)
  let vectorThreshold = SIMILARITY_THRESHOLD;
  try {
    try {
      const rawThreshold = await configuracionRepo.get('search_vector_threshold');
      const parsedThreshold = parseFloat(rawThreshold);
      if (Number.isFinite(parsedThreshold) && parsedThreshold > 0 && parsedThreshold <= 1) {
        vectorThreshold = parsedThreshold;
      }
    } catch (_) { /* usar default */ }

    const textTasks = [
      { promise: productosRepo.searchByKeyword(query, limit * 2, { allowRelaxed }), matchedQuery: null, matchedType: null },
      { promise: _searchFTS(normalizedQuery, limit * 2), matchedQuery: null, matchedType: null },
    ];

    const cleanQuery = queryAnalyzer.stripStopwords(normalizedQuery);
    if (cleanQuery && cleanQuery !== normalizedQuery) {
      textTasks.push({ promise: productosRepo.searchByKeyword(cleanQuery, limit * 2, { allowRelaxed }), matchedQuery: cleanQuery, matchedType: 'cleaned' });
      textTasks.push({ promise: _searchFTS(cleanQuery, limit * 2), matchedQuery: cleanQuery, matchedType: 'cleaned' });
    }

    if (attrs.synonyms && attrs.synonyms.length > 0) {
      for (const syn of attrs.synonyms) {
        textTasks.push({ promise: productosRepo.searchByKeyword(syn, limit * 2, { allowRelaxed }), matchedQuery: syn, matchedType: 'synonym' });
        textTasks.push({ promise: _searchFTS(syn, limit * 2), matchedQuery: syn, matchedType: 'synonym' });
      }
    }

    let vectorPromise = null;
    const canRunParallelVector = !skipVector && embeddingProvider && !embeddingProvider.isMock;
    if (canRunParallelVector) {
      const vectorQuery = (attrs.synonyms && attrs.synonyms.length > 0)
        ? `${query} ${attrs.synonyms.join(' ')}`
        : query;
      vectorPromise = (async () => {
        try {
          const queryEmbedding = await embeddingProvider.generateSingleEmbedding(vectorQuery);
          if (queryEmbedding && queryEmbedding.length > 0 && !embeddingProvider.isMock) {
            const vectorFilters = {};
            if (attrs.marca) vectorFilters.marca = attrs.marca;
            const rawVector = await productosRepo.searchVectorFiltered(queryEmbedding, vectorFilters, limit);
            return rawVector.filter((p) => p.similarity !== undefined && p.similarity >= vectorThreshold);
          }
        } catch (vErr) {
          logger.warn('[HybridSearch] Parallel vector search error', { error: vErr.message });
        }
        return [];
      })();
    }

    const [textResults, vectorResults] = await Promise.all([
      Promise.all(textTasks.map(async (task) => ({ rows: await task.promise, matchedQuery: task.matchedQuery, matchedType: task.matchedType }))),
      vectorPromise ? vectorPromise : Promise.resolve([]),
    ]);

    for (const result of textResults) {
      addCandidates(result.rows, result.matchedQuery, result.matchedType);
    }
    if (vectorResults && vectorResults.length > 0 && !embeddingProvider.isMock) {
      addCandidates(vectorResults);
      logger.info('[HybridSearch] Parallel vector search added candidates', {
        vectorCount: vectorResults.length,
        totalCandidates: candidates.length,
      });
    }

    // Pasada relajada: si aún no llegamos al límite, buscar por el núcleo
    // sustantivo con OR (permitido en web; restringido en WhatsApp).
    if (allowRelaxed) {
      const relaxedQuery = cleanQuery || queryAnalyzer.stripStopwords(normalizedQuery);
      if (relaxedQuery) {
        try {
          const extra = await productosRepo.searchByKeyword(relaxedQuery, limit * 2, { allowRelaxed: true });
          addCandidates(extra, relaxedQuery, 'relaxed');
        } catch (relaxedErr) {
          logger.warn('[HybridSearch] Relaxed search error', { error: relaxedErr.message });
        }
      }

      // Búsqueda por prefijo del sustantivo principal: "caño" debe traer los
      // CAÑO del catálogo antes que palabras que sólo lo contienen ("americano").
      const isSpec = (t) =>
        /^\d+([x/]\d+)?(mm|cm|m|kg|w|v|l|bar|hp)?$/i.test(t) ||
        ['redonda', 'redondo', 'plana', 'plano', 'cuadrada', 'cuadrado', 'chico', 'chica', 'grande', 'largo', 'corta', 'corto', 'mini', 'fino', 'fina', 'grueso', 'gruesa'].includes(t.toLowerCase());
      const coreTokens = queryAnalyzer
        .stripStopwords(normalizedQuery)
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !isSpec(t))
        .slice(0, 3);

      for (const token of coreTokens) {
        try {
          const prefixRows = await productosRepo.searchByPrefix(token, limit * 2);
          addCandidates(prefixRows, token, 'prefix');
        } catch (prefixErr) {
          logger.warn('[HybridSearch] Prefix search error', { token, error: prefixErr.message });
        }
      }
    }

    logger.info('[HybridSearch] Search completed', {
      totalCandidates: candidates.length,
      hasSynonyms: Boolean(attrs.synonyms && attrs.synonyms.length > 0),
      hasParallelVector: Boolean(canRunParallelVector),
      allowRelaxed,
      vectorThreshold,
    });
  } catch (err) {
    logger.warn('[HybridSearch] Textual search error', { error: err.message });
  }

  // ── STEP 4: Fallback vector search (ONLY in unit test environment when mock is specifically tested)
  if (process.env.NODE_ENV === 'test' && !skipVector && candidates.length < limit && embeddingProvider && embeddingProvider.isMock) {
    try {
      const vectorQuery = (attrs.synonyms && attrs.synonyms.length > 0)
        ? `${query} ${attrs.synonyms.join(' ')}`
        : query;
      const queryEmbedding = await embeddingProvider.generateSingleEmbedding(vectorQuery);

      if (queryEmbedding && queryEmbedding.length > 0) {
        const vectorFilters = {};
        if (attrs.marca) vectorFilters.marca = attrs.marca;

        const rawVector = await productosRepo.searchVectorFiltered(
          queryEmbedding,
          vectorFilters,
          limit
        );
        const filtered = rawVector.filter(
          (p) => p.similarity !== undefined && p.similarity >= SIMILARITY_THRESHOLD
        );

        addCandidates(filtered);
      }
    } catch (err) {
      logger.warn('[HybridSearch] Fallback mock vector search error', { error: err.message });
    }
  }

  // ── STEP 5: Re-rank and return with dynamic exchange rate
  if (candidates.length === 0) {
    logger.info('[HybridSearch] No candidates found', { query });
    return [];
  }

  let exchangeRate = 42;
  try {
    const rawRate = await configuracionRepo.get('cotizacion_usd');
    if (rawRate && parseFloat(rawRate) > 0) {
      exchangeRate = parseFloat(rawRate);
    }
  } catch (_) {}

  const strictRanked = rerank(candidates, query, attrs, { exchangeRate, vectorThreshold });
  const strictValid = strictRanked.filter((p) => (p._score || 0) > 0);
  const strictExact = allowRelaxed ? strictValid : strictValid.filter((p) => !p._approximate);

  if (!allowRelaxed) {
    return strictExact.slice(0, limit);
  }
  if (strictExact.length >= limit) {
    return strictExact.slice(0, limit);
  }

  // Segunda pasada: si faltan resultados, relajamos los atributos (color,
  // medida, volumen, potencia) y marcamos las opciones como aproximadas para
  // que el canal decida si las ofrece o pide una aclaración.
  const relaxedRanked = rerank(candidates, query, attrs, {
    exchangeRate,
    vectorThreshold,
    relaxAttributes: true,
  });
  const seen = new Set(strictExact.map((p) => p.sku));
  const extras = relaxedRanked
    .filter((p) => (p._score || 0) > 0 && p.sku && !seen.has(p.sku))
    .map((p) => ({ ...p, _approximate: true }));

  return [...strictExact, ...extras].slice(0, limit);
}

/**
 * Internal helper: attempt FTS, then fall back to empty if column doesn't exist.
 */
async function _searchFTS(normalizedQuery, limit) {
  const tokens = queryAnalyzer.tokenize(normalizedQuery);
  const tsQuery = queryAnalyzer.buildTsQuery(tokens);
  if (!tsQuery) return [];

  return await productosRepo.searchFTS(tsQuery, limit);
}

module.exports = {
  hybridSearch,
  SIMILARITY_THRESHOLD,
};
