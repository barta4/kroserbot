require('dotenv').config();

let openai = null;
try {
  if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
} catch (_err) {
  openai = null;
}

let gemini = null;
try {
  if (process.env.GEMINI_API_KEY) {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    gemini = genAI.getGenerativeModel({ model: 'text-embedding-004' });
  }
} catch (_err) {
  gemini = null;
}

const logger = require('../../config/logger');

// Deterministic pseudo-embedding fallback (768 dimensions) for offline dev/tests
function generateMockEmbedding(text) {
  const vector = new Array(768).fill(0);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  for (let i = 0; i < 768; i++) {
    vector[i] = Math.sin(hash + i) * 0.5 + 0.5;
  }
  return vector;
}

const configuracionRepo = require('../../repositories/configuracionRepository');

module.exports = {
  async generateSingleEmbedding(text) {
    const batchResult = await this.generateBatchEmbeddings([text]);
    return batchResult[0];
  },

  async generateBatchEmbeddings(textArray) {
    if (!textArray || textArray.length === 0) return [];

    const configs = (await configuracionRepo.getMultiple([
      'llm_provider',
      'llm_fallback_provider',
      'llm_api_key',
      'llm_fallback_api_key',
      'llm_base_url',
      'llm_fallback_base_url',
    ])) || {};

    const primaryProvider = configs.llm_provider || 'gemini';
    const fallbackProvider = configs.llm_fallback_provider || (primaryProvider === 'gemini' ? 'openai' : 'gemini');

    let gemKey = process.env.GEMINI_API_KEY || '';
    let oaiKey = process.env.OPENAI_API_KEY || '';
    let oaiBaseUrl = process.env.OPENAI_BASE_URL || '';

    // Assign keys according to configured provider roles
    if (primaryProvider === 'gemini' && configs.llm_api_key?.trim()) {
      gemKey = configs.llm_api_key.trim();
    } else if (fallbackProvider === 'gemini' && configs.llm_fallback_api_key?.trim()) {
      gemKey = configs.llm_fallback_api_key.trim();
    }

    if (primaryProvider === 'openai' && configs.llm_api_key?.trim()) {
      oaiKey = configs.llm_api_key.trim();
      if (configs.llm_base_url?.trim()) oaiBaseUrl = configs.llm_base_url.trim();
    } else if (fallbackProvider === 'openai' && configs.llm_fallback_api_key?.trim()) {
      oaiKey = configs.llm_fallback_api_key.trim();
      if (configs.llm_fallback_base_url?.trim()) oaiBaseUrl = configs.llm_fallback_base_url.trim();
    }

    // Auto-detect keys if not matched by role
    if (!gemKey && configs.llm_api_key?.startsWith('AIza')) gemKey = configs.llm_api_key.trim();
    if (!gemKey && configs.llm_fallback_api_key?.startsWith('AIza')) gemKey = configs.llm_fallback_api_key.trim();
    if (!oaiKey && configs.llm_api_key?.startsWith('sk-')) oaiKey = configs.llm_api_key.trim();
    if (!oaiKey && configs.llm_fallback_api_key?.startsWith('sk-')) oaiKey = configs.llm_fallback_api_key.trim();

    // Helper functions with exponential backoff for rate limits
    const withRetry = async (fn, name) => {
      let attempts = 0;
      const maxRetries = 2;
      while (attempts <= maxRetries) {
        try {
          return await fn();
        } catch (err) {
          attempts++;
          const isRateLimit =
            err?.status === 429 ||
            err?.message?.includes('429') ||
            err?.message?.includes('quota') ||
            err?.message?.includes('RESOURCE_EXHAUSTED');
          if (attempts > maxRetries || !isRateLimit) {
            logger.warn(`[EmbeddingProvider Warning] ${name} embedding failed: ${err.message}`);
            return null;
          }
          const backoff = attempts * 1000;
          logger.warn(`[EmbeddingProvider] ${name} rate limit (429) hit, retrying in ${backoff}ms (attempt ${attempts}/${maxRetries})...`);
          await new Promise((resolve) => setTimeout(resolve, backoff));
        }
      }
      return null;
    };

    const tryGemini = async () => {
      if (!gemKey) return null;
      return await withRetry(async () => {
        const { GoogleGenerativeAI } = require('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(gemKey);
        const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
        logger.info(`[EmbeddingProvider] Generating ${textArray.length} embeddings via Gemini API...`);
        if (typeof model.batchEmbedContents === 'function') {
          const batchRes = await model.batchEmbedContents({
            requests: textArray.map((text) => ({
              content: { parts: [{ text }] },
            })),
          });
          if (batchRes && batchRes.embeddings) {
            this.isMock = false;
            return batchRes.embeddings.map((e) => e.values);
          }
        }
        const results = await Promise.all(
          textArray.map(async (text) => {
            const res = await model.embedContent(text);
            return res.embedding.values;
          })
        );
        this.isMock = false;
        return results;
      }, 'Gemini');
    };

    const tryOpenAI = async () => {
      if (!oaiKey) return null;
      return await withRetry(async () => {
        const OpenAI = require('openai');
        const opts = { apiKey: oaiKey };
        if (oaiBaseUrl && !oaiBaseUrl.includes('api.openai.com')) {
          opts.baseURL = oaiBaseUrl.replace(/\/+$/, '');
        }
        const client = new OpenAI(opts);
        logger.info(`[EmbeddingProvider] Generating ${textArray.length} embeddings via OpenAI API...`);
        const response = await client.embeddings.create({
          model: 'text-embedding-3-small',
          dimensions: 768,
          input: textArray,
        });
        this.isMock = false;
        return response.data.map((item) => item.embedding);
      }, 'OpenAI');
    };

    // Execute in priority order based on primary provider
    if (primaryProvider === 'gemini') {
      const gemRes = await tryGemini();
      if (gemRes) return gemRes;
      const oaiRes = await tryOpenAI();
      if (oaiRes) return oaiRes;
    } else {
      const oaiRes = await tryOpenAI();
      if (oaiRes) return oaiRes;
      const gemRes = await tryGemini();
      if (gemRes) return gemRes;
    }

    // 3. Mock Fallback (only if both failed or no keys available)
    this.isMock = true;
    logger.info(`[EmbeddingProvider] Generating ${textArray.length} deterministic mock embeddings.`);
    return textArray.map((txt) => generateMockEmbedding(txt));
  },

  async getActiveProviderInfo() {
    const configs = (await configuracionRepo.getMultiple([
      'llm_provider',
      'llm_fallback_provider',
      'llm_api_key',
      'llm_fallback_api_key',
    ])) || {};

    const primary = configs.llm_provider || 'gemini';
    const fallback = configs.llm_fallback_provider || (primary === 'gemini' ? 'openai' : 'gemini');

    const hasGemKey = Boolean(
      process.env.GEMINI_API_KEY ||
      (primary === 'gemini' && configs.llm_api_key?.trim()) ||
      (fallback === 'gemini' && configs.llm_fallback_api_key?.trim())
    );
    const hasOaiKey = Boolean(
      process.env.OPENAI_API_KEY ||
      (primary === 'openai' && configs.llm_api_key?.trim()) ||
      (fallback === 'openai' && configs.llm_fallback_api_key?.trim())
    );

    return {
      primaryProvider: primary,
      fallbackProvider: fallback,
      hasGeminiKey: hasGemKey,
      hasOpenAIKey: hasOaiKey,
      isConfigured: hasGemKey || hasOaiKey,
      isMock: this.isMock ?? !(hasGemKey || hasOaiKey),
      dimensions: 768,
      modelGemini: 'text-embedding-004',
      modelOpenAI: 'text-embedding-3-small (768d)',
    };
  },
};
