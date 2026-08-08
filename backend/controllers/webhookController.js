const webhookService = require('../services/webhook/webhookService');
const debounceService = require('../services/webhook/debounceService');

module.exports = {
  async handleWebhook(req, res, next) {
    try {
      const payload = req.body;
      const conversationId = payload.conversation?.id || payload.conversation_id;
      const content = (payload.message?.content || payload.content || '').trim();

      // Send 200 OK immediately to Chatwoot to avoid Chatwoot timeout
      res.status(200).json({ status: 'received' });

      if (conversationId && content && payload.event === 'message_created') {
        // Use debounce to aggregate messages sent within ~8s
        debounceService.addMessage(conversationId, content, async (fullContent) => {
          const customPayload = {
            ...payload,
            message: {
              ...(payload.message || {}),
              content: fullContent,
            },
          };
          await webhookService.processWebhookEvent(customPayload);
        });
      } else {
        // Direct non-debounced processing
        await webhookService.processWebhookEvent(payload);
      }
    } catch (err) {
      next(err);
    }
  },
};
