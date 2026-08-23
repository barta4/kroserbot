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

    logger.info('Message buffered for debounce', { conversationId, waitMs: DEBOUNCE_WAIT_MS });

    buffer.timer = setTimeout(async () => {
      const fullText = buffer.messages.join(' ');
      pendingBuffers.delete(conversationId);

      logger.info('Debounced messages executing', { conversationId, messageCount: buffer.messages.length });
      try {
        await processCallback(fullText);
      } catch (err) {
        logger.error('Debounce process error', { conversationId, error: err.message });
      }
    }, DEBOUNCE_WAIT_MS);
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
