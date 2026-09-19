const webhookService = require('../services/webhook/webhookService');
const debounceService = require('../services/webhook/debounceService');
const { webhookPayloadSchema } = require('../schemas');
const logger = require('../config/logger');

module.exports = {
  async handleWebhook(req, res, next) {
    try {
      const validation = webhookPayloadSchema.safeParse(req.body);
      if (!validation.success) {
        logger.warn('Webhook payload validation failed', { errors: validation.error.issues });
        return res.status(400).json({
          error: 'Payload de webhook inválido',
          details: validation.error.issues,
        });
      }

      const payload = validation.data;
      const conversationId = payload.conversation?.id || payload.conversation_id;
      const content = (payload.message?.content || payload.content || '').trim();

      // Send 200 OK immediately to Chatwoot after successful contract validation
      res.status(200).json({ status: 'received' });

      const sender = payload.message?.sender || payload.sender || {};
      const isOutgoing = payload.message?.message_type === 'outgoing' || payload.message_type === 'outgoing';
      const isAgentOrOutgoing =
        isOutgoing ||
        sender.type === 'agent' ||
        sender.type === 'bot' ||
        (sender.type === 'user' && isOutgoing);

      if (conversationId && content && payload.event === 'message_created' && !isAgentOrOutgoing) {
        // Use debounce to aggregate user messages sent within ~8s
        debounceService.addMessage(conversationId, content, async (fullContent) => {
          try {
            const customPayload = {
              ...payload,
              _alreadyDebounced: true,
              message: {
                ...(payload.message || {}),
                content: fullContent,
              },
            };
            await webhookService.processWebhookEvent(customPayload);
          } catch (err) {
            logger.error('[WebhookController] Error en callback de debounce:', { error: err.message });
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
        logger.error('[WebhookController] Error asíncrono procesando webhook:', { error: err.message });
      }
    }
  },
};
