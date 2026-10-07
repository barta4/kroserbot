/**
 * messageSplitter.js
 * 
 * Utility to split bot responses into natural, human-like chat bubbles (chunks)
 * for WhatsApp and Uruchat omnichannel inboxes.
 * 
 * Objectives:
 * 1. Eliminate "libros" (massive walls of text / essays) in favor of conversational pacing.
 * 2. Allow simulated human typing indicators between message bubbles.
 * 3. Never split inside currency amounts ($1.450), URLs, or technical abbreviations.
 */

const MIN_LENGTH_TO_SPLIT = 80;
const MIN_CHUNK_LENGTH = 20;
const MAX_CHUNKS = 2; // WhatsApp best practice: max 2 bubbles to avoid notification spam

/**
 * Splits text into 1 or 2 natural message bubbles.
 * 
 * @param {string} text - Raw assistant reply
 * @param {number} maxChunks - Maximum number of chunks (default: 2)
 * @returns {string[]} Array of message chunks
 */
function splitIntoChunks(text = '', maxChunks = MAX_CHUNKS) {
  if (!text || typeof text !== 'string') return [];
  // Clean markdown horizontal dividers (---, ***, ___) into paragraph breaks
  const sanitized = text.replace(/(?:\r?\n|^)\s*[-*_]{3,}\s*(?:\r?\n|$)/g, '\n\n');
  const trimmed = sanitized.trim();
  if (!trimmed) return [];

  // Short messages stay as a single bubble
  if (trimmed.length < MIN_LENGTH_TO_SPLIT) {
    return [trimmed];
  }

  // 1. Natural paragraph breaks (\n\n or \n)
  const paragraphs = trimmed
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length >= 2) {
    if (paragraphs.length <= maxChunks) {
      if (paragraphs.every((p) => p.length >= MIN_CHUNK_LENGTH)) {
        return paragraphs;
      }
    } else {
      // If 3+ paragraphs, join earlier ones and keep final (usually CTA or question) separate
      const firstPart = paragraphs.slice(0, paragraphs.length - 1).join('\n');
      const secondPart = paragraphs[paragraphs.length - 1];
      if (firstPart.length >= MIN_CHUNK_LENGTH && secondPart.length >= MIN_CHUNK_LENGTH) {
        return [firstPart, secondPart];
      }
    }
  }

  // 2. Split before closing questions or follow-up CTAs (e.g. ". ¿..." or "! ¿...")
  // Real humans often send the product info first, then ask the question in a second bubble.
  const questionMatch = trimmed.match(/[.!?]\s+(¿[A-ZÁÉÍÓÚa-záéíóú])/);
  if (questionMatch && typeof questionMatch.index === 'number') {
    const splitIndex = questionMatch.index + 1; // right after punctuation mark
    const firstChunk = trimmed.slice(0, splitIndex).trim();
    const secondChunk = trimmed.slice(splitIndex).trim();

    if (firstChunk.length >= MIN_CHUNK_LENGTH && secondChunk.length >= MIN_CHUNK_LENGTH) {
      return [firstChunk, secondChunk];
    }
  }

  // 3. Sentence boundary split on period, exclamation, or question mark followed by uppercase letter
  // Avoid splitting inside numbers ($2.490, 1.5m) and common abbreviations (ej., u$s., sr.)
  const sentenceBoundaryRegex = /(?<!\d|\b(?:ej|sr|sra|dr|dra|u\$s|art|no|pág|[A-Z]))([.!?])\s+([A-ZÁÉÍÓÚ¿¡])/g;
  let match;
  let bestSplitIndex = -1;
  const midPoint = trimmed.length / 2;
  let minDistanceToMid = Infinity;

  while ((match = sentenceBoundaryRegex.exec(trimmed)) !== null) {
    const splitPos = match.index + 1;
    const chunk1Candidate = trimmed.slice(0, splitPos).trim();
    const chunk2Candidate = trimmed.slice(splitPos).trim();

    if (chunk1Candidate.length >= 40 && chunk2Candidate.length >= 30) {
      const dist = Math.abs(splitPos - midPoint);
      if (dist < minDistanceToMid) {
        minDistanceToMid = dist;
        bestSplitIndex = splitPos;
      }
    }
  }

  if (bestSplitIndex !== -1) {
    const chunk1 = trimmed.slice(0, bestSplitIndex).trim();
    const chunk2 = trimmed.slice(bestSplitIndex).trim();
    return [chunk1, chunk2];
  }

  // Fallback: single chunk if no clean sentence boundary found
  return [trimmed];
}

module.exports = {
  splitIntoChunks,
  MIN_LENGTH_TO_SPLIT,
  MIN_CHUNK_LENGTH,
  MAX_CHUNKS,
};
