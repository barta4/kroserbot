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

module.exports = {
  async generateSingleEmbedding(text) {
    const batchResult = await this.generateBatchEmbeddings([text]);
    return batchResult[0];
  },

  async generateBatchEmbeddings(textArray) {
    if (!textArray || textArray.length === 0) return [];

    // 1. Try OpenAI API
    if (openai && process.env.OPENAI_API_KEY) {
      try {
        console.log(`[EmbeddingProvider] Generating ${textArray.length} embeddings via OpenAI API...`);
        const response = await openai.embeddings.create({
          model: 'text-embedding-3-small',
          dimensions: 768,
          input: textArray,
        });
        return response.data.map((item) => item.embedding);
      } catch (err) {
        console.warn(`[EmbeddingProvider Warning] OpenAI embedding failed (${err.message}). Using fallback.`);
      }
    }

    // 2. Try Gemini API
    if (gemini && process.env.GEMINI_API_KEY) {
      try {
        console.log(`[EmbeddingProvider] Generating embeddings via Gemini API...`);
        const results = [];
        for (const text of textArray) {
          const res = await gemini.embedContent(text);
          results.push(res.embedding.values);
        }
        return results;
      } catch (err) {
        console.warn(`[EmbeddingProvider Warning] Gemini embedding failed (${err.message}). Using fallback.`);
      }
    }

    // 3. Mock Fallback
    console.log(`[EmbeddingProvider] Generating ${textArray.length} deterministic mock embeddings.`);
    return textArray.map((txt) => generateMockEmbedding(txt));
  },
};
