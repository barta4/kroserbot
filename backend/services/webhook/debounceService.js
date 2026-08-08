const redis = require('../../config/redis');

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

    console.log(`[Debounce] Buffered message for conv #${conversationId} (waiting ${DEBOUNCE_WAIT_MS}ms)...`);

    buffer.timer = setTimeout(async () => {
      const fullText = buffer.messages.join(' ');
      pendingBuffers.delete(conversationId);

      console.log(`[Debounce] Executing bundled messages for conv #${conversationId}: "${fullText}"`);
      try {
        await processCallback(fullText);
      } catch (err) {
        console.error(`[Debounce Process Error] Conv #${conversationId}:`, err.message);
      }
    }, DEBOUNCE_WAIT_MS);
  },
};
