const webhookService = require('../services/webhook/webhookService');
const debounceService = require('../services/webhook/debounceService');
const botLoopDetector = require('../services/guardrails/botLoopDetector');
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
      let content = (payload.message?.content || payload.content || '').trim();

      // Send 200 OK immediately to Chatwoot/Uruchat after successful contract validation
      res.status(200).json({ status: 'received' });

      const sender = (payload.message?.sender && typeof payload.message.sender === 'object')
        ? payload.message.sender
        : (payload.sender && typeof payload.sender === 'object')
          ? payload.sender
          : {};
      const rawMsgType = String(payload.message?.message_type || payload.message_type || '').toLowerCase();
      const isOutgoing = rawMsgType === 'outgoing' || rawMsgType === '1';
      const isAgentOrOutgoing =
        isOutgoing ||
        sender.type === 'agent' ||
        sender.type === 'bot' ||
        (sender.type === 'user' && isOutgoing);

      const attachments = (Array.isArray(payload.message?.attachments) && payload.message.attachments.length > 0)
        ? payload.message.attachments
        : (Array.isArray(payload.attachments) && payload.attachments.length > 0)
          ? payload.attachments
          : [];
      const hasAttachments = attachments.length > 0;

      // Check early if message is a server bounce or noreply to skip unnecessary ~8s debounce delay
      const isEarlyDropEmail = !isAgentOrOutgoing && (botLoopDetector.isNoReply(payload) || botLoopDetector.isServerBounce(payload));

      // If incoming customer message has attachments (audio note, photo, document), flush any pending debounce text
      // and process immediately so media is never delayed, dropped, or desynchronized.
      if (hasAttachments && conversationId && !isAgentOrOutgoing) {
        const pendingText = debounceService.getAndClear(conversationId);
        if (pendingText) {
          content = content ? `${pendingText}\n${content}` : pendingText;
        }
        const mediaPayload = {
          ...payload,
          message: {
            ...(payload.message || {}),
            content,
            attachments,
          },
          attachments,
        };
        await webhookService.processWebhookEvent(mediaPayload);
      } else if (isEarlyDropEmail) {
        // Direct non-debounced processing for server bounces and no-reply emails
        await webhookService.processWebhookEvent(payload);
      } else if (conversationId && content && payload.event === 'message_created' && !isAgentOrOutgoing) {
        // Use debounce to aggregate user messages sent within ~8s
        debounceService.addMessage(conversationId, content, async (fullContent) => {
          try {
            const customPayload = {
              ...payload,
              _alreadyDebounced: true,
              message: {
                ...(payload.message || {}),
                content: fullContent,
                attachments,
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
