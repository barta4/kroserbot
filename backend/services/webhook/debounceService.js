const redis = require('../../config/redis');
const logger = require('../../config/logger');

const DEBOUNCE_WAIT_MS = parseInt(process.env.DEBOUNCE_WAIT_MS || '8000', 10);
const pendingBuffers = new Map();

module.exports = {
  async addMessage(conversationId, messageText, processCallback) {
    if (!pendingBuffers.has(conversationId)) {
      pendingBuffers.set(conversationId, {
        messages: [],
        timer: null,
      });
    }

    const buffer = pendingBuffers.get(conversationId);
    buffer.messages.push(messageText);

    if (buffer.timer) {
      clearTimeout(buffer.timer);
    }

    // Adaptive debounce: if current fragment is very short (< 15 chars), give shorter timeout
    let waitMs = DEBOUNCE_WAIT_MS;
    if (messageText.trim().length < 15 && buffer.messages.length === 1) {
      waitMs = Math.max(3000, Math.floor(DEBOUNCE_WAIT_MS * 0.6));
    }

    logger.info('Message buffered for debounce', { conversationId, waitMs });

    buffer.timer = setTimeout(async () => {
      const fullText = buffer.messages.join('\n');
      pendingBuffers.delete(conversationId);

      logger.info('Debounced messages executing', { conversationId, messageCount: buffer.messages.length });
      try {
        await processCallback(fullText);
      } catch (err) {
        logger.error('Debounce process error', { conversationId, error: err.message });
      }
    }, waitMs);
  },

  cancel(conversationId) {
    if (pendingBuffers.has(conversationId)) {
      const buffer = pendingBuffers.get(conversationId);
      if (buffer.timer) {
        clearTimeout(buffer.timer);
      }
      pendingBuffers.delete(conversationId);
      logger.info('Debounce buffer cancelled for conversation', { conversationId });
      return true;
    }
    return false;
  },
};
