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
async function hybridSearch(rawQuery, { limit = 5, skipVector = false } = {}) {
  if (!rawQuery || typeof rawQuery !== 'string' || !rawQuery.trim()) {
    return [];
  }

  const query = rawQuery.trim();
  const normalizedQuery = queryAnalyzer.normalizeQuery(query);
  const candidates = [];
  const seenSkus = new Set();

  // Helper to add candidates without duplicates
  const addCandidates = (items) => {
    for (const item of items) {
      if (item.sku && !seenSkus.has(item.sku)) {
        seenSkus.add(item.sku);
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
  try {
    const textPromises = [
      productosRepo.searchByKeyword(query, limit * 2),
      _searchFTS(normalizedQuery, limit * 2),
    ];

    const cleanQuery = queryAnalyzer.stripStopwords(normalizedQuery);
    if (cleanQuery && cleanQuery !== normalizedQuery) {
      textPromises.push(productosRepo.searchByKeyword(cleanQuery, limit * 2));
      textPromises.push(_searchFTS(cleanQuery, limit * 2));
    }

    if (attrs.synonyms && attrs.synonyms.length > 0) {
      for (const syn of attrs.synonyms) {
        textPromises.push(productosRepo.searchByKeyword(syn, limit * 2));
        textPromises.push(_searchFTS(syn, limit * 2));
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
          if (queryEmbedding && queryEmbedding.length > 0) {
            const vectorFilters = {};
            if (attrs.marca) vectorFilters.marca = attrs.marca;
            const rawVector = await productosRepo.searchVectorFiltered(queryEmbedding, vectorFilters, limit);
            return rawVector.filter((p) => p.similarity !== undefined && p.similarity >= SIMILARITY_THRESHOLD);
          }
        } catch (vErr) {
          logger.warn('[HybridSearch] Parallel vector search error', { error: vErr.message });
        }
        return [];
      })();
    }

    const [textResults, vectorResults] = await Promise.all([
      Promise.all(textPromises),
      vectorPromise ? vectorPromise : Promise.resolve([]),
    ]);

    for (const r of textResults) {
      addCandidates(r);
    }
    if (vectorResults && vectorResults.length > 0) {
      addCandidates(vectorResults);
      logger.info('[HybridSearch] Parallel vector search added candidates', {
        vectorCount: vectorResults.length,
        totalCandidates: candidates.length,
      });
    }

    logger.info('[HybridSearch] Search completed', {
      totalCandidates: candidates.length,
      hasSynonyms: Boolean(attrs.synonyms && attrs.synonyms.length > 0),
      hasParallelVector: Boolean(canRunParallelVector),
    });
  } catch (err) {
    logger.warn('[HybridSearch] Textual search error', { error: err.message });
  }

  // ── STEP 4: Fallback vector search (for mock provider during test/dev if needed)
  if (!skipVector && candidates.length < limit && embeddingProvider && embeddingProvider.isMock) {
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

  const ranked = rerank(candidates, query, attrs, { exchangeRate });
  // Exclude products whose category was penalized to zero or below
  const validRanked = ranked.filter((p) => (p._score || 0) > 0);
  return validRanked.slice(0, limit);
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
