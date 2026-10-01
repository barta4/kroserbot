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

  // ── STEP 3: Textual search (two approaches in parallel + synonyms + clean stopwords)
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
      const synQuery = attrs.synonyms.join(' ');
      textPromises.push(productosRepo.searchByKeyword(synQuery, limit * 2));
      textPromises.push(_searchFTS(synQuery, limit * 2));
    }

    const textResults = await Promise.all(textPromises);
    for (const r of textResults) {
      addCandidates(r);
    }

    logger.info('[HybridSearch] Textual search completed', {
      totalCandidates: candidates.length,
      hasSynonyms: Boolean(attrs.synonyms && attrs.synonyms.length > 0),
    });
  } catch (err) {
    logger.warn('[HybridSearch] Textual search error', { error: err.message });
  }

  // ── STEP 4: Vector search (only if we need more candidates)
  if (!skipVector && candidates.length < limit) {
    try {
      if (embeddingProvider && !embeddingProvider.isMock) {
        const vectorQuery = (attrs.synonyms && attrs.synonyms.length > 0)
          ? `${query} ${attrs.synonyms.join(' ')}`
          : query;
        const queryEmbedding = await embeddingProvider.generateSingleEmbedding(vectorQuery);

        if (queryEmbedding && queryEmbedding.length > 0 && !embeddingProvider.isMock) {
          // Build pre-filters from extracted attributes
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

          logger.info('[HybridSearch] Vector search completed', {
            raw: rawVector.length,
            aboveThreshold: filtered.length,
            totalCandidates: candidates.length,
          });
        }
      }
    } catch (err) {
      logger.warn('[HybridSearch] Vector search error', { error: err.message });
    }
  }

  // ── STEP 5: Re-rank and return
  if (candidates.length === 0) {
    logger.info('[HybridSearch] No candidates found', { query });
    return [];
  }

  const ranked = rerank(candidates, query, attrs);
  return ranked.slice(0, limit);
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
