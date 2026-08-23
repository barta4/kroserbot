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

      const sender = payload.message?.sender || payload.sender || {};
      const isAgentOrOutgoing =
        payload.message?.message_type === 'outgoing' ||
        sender.type === 'agent' ||
        sender.type === 'bot';

      if (conversationId && content && payload.event === 'message_created' && !isAgentOrOutgoing) {
        // Use debounce to aggregate user messages sent within ~8s
        debounceService.addMessage(conversationId, content, async (fullContent) => {
          try {
            const customPayload = {
              ...payload,
              message: {
                ...(payload.message || {}),
                content: fullContent,
              },
            };
            await webhookService.processWebhookEvent(customPayload);
          } catch (err) {
            console.error('[WebhookController] Error en callback de debounce:', err);
          }
        });
      } else {
        // Direct non-debounced processing (agent messages, status updates, etc.)
        await webhookService.processWebhookEvent(payload);
      }
    } catch (err) {
      if (!res.headersSent) {
        next(err);
      } else {
        console.error('[WebhookController] Error asíncrono procesando webhook:', err);
      }
    }
  },
};
