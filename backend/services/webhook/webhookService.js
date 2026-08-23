const redis = require('../../config/redis');
const configuracionRepo = require('../../repositories/configuracionRepository');
const conversacionesRepo = require('../../repositories/conversacionesRepository');
const ragService = require('../embeddings/ragService');
const llmService = require('../llm/llmService');
const chatwootService = require('../chatwoot/chatwootService');
const emailService = require('../email/emailService');
const pedidosService = require('../pedidos/pedidosService');
const ecommerceOrderService = require('../ecommerce/ecommerceOrderService');
const debounceService = require('./debounceService');
const logger = require('../../config/logger');

const IDEMPOTENCY_TTL = 3600; // 1 hour
const HUMAN_ACTIVE_TTL = 86400; // 24 hours

async function isChannelDisabled(payload, conversation) {
  const rawConfig = await configuracionRepo.get('canales_desactivados');
  if (!rawConfig) return false;

  let disabledList = [];
  try {
    const trimmed = rawConfig.trim();
    if (trimmed.startsWith('[')) {
      disabledList = JSON.parse(trimmed);
    } else {
      disabledList = trimmed.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    }
  } catch (_e) {
    disabledList = rawConfig.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  }

  if (!Array.isArray(disabledList) || disabledList.length === 0) return false;

  const normalizedDisabled = disabledList.map(item => String(item).toLowerCase().trim());

  const channelType = (
    conversation.channel ||
    conversation.inbox?.channel_type ||
    payload.inbox?.channel_type ||
    payload.channel ||
    payload.channel_type ||
    ''
  ).toLowerCase();

  const inboxName = (
    conversation.inbox?.name ||
    payload.inbox?.name ||
    ''
  ).toLowerCase();

  const inboxId = String(
    conversation.inbox_id ||
    conversation.inbox?.id ||
    payload.inbox?.id ||
    ''
  );

  for (const disabled of normalizedDisabled) {
    if (!disabled) continue;

    // Check by channel type (e.g. 'instagram', 'channel::instagram', 'whatsapp', 'email', 'webwidget')
    if (channelType) {
      if (channelType === disabled || channelType.includes(disabled) || disabled.includes(channelType)) {
        return { disabled: true, match: disabled, channelType };
      }
    }

    // Check by inbox ID (e.g. '3', 'inbox:3')
    if (inboxId && (disabled === inboxId || disabled === `inbox:${inboxId}`)) {
      return { disabled: true, match: disabled, inboxId };
    }

    // Check by inbox name (e.g. 'instagram oficial')
    if (inboxName && (inboxName === disabled || inboxName.includes(disabled) || disabled.includes(inboxName))) {
      return { disabled: true, match: disabled, inboxName };
    }
  }

  return false;
}

module.exports = {
  async processWebhookEvent(payload) {
    const correlationId = `conv_${payload.conversation?.id || 'unknown'}_${Date.now()}`;
    logger.info('Webhook event received', { correlationId, event: payload.event });

    const conversation = payload.conversation || {};
    const conversationId = conversation.id || payload.conversation_id;
    const accountId = payload.account?.id || conversation.account_id || 1;

    // 0. Handle Conversation Assignment & Status Changes (Chatwoot conversation_updated / conversation_status_changed)
    if (payload.event === 'conversation_updated' || payload.event === 'conversation_status_changed') {
      const assigneeId = conversation.assignee_id || conversation.meta?.assignee?.id || conversation.assignee?.id;
      const botAgentId = await configuracionRepo.get('chatwoot_bot_agent_id');

      if (conversationId) {
        if (assigneeId && (!botAgentId || String(assigneeId) !== String(botAgentId))) {
          await redis.set(`human_active:${conversationId}`, '1', 'EX', HUMAN_ACTIVE_TTL);
          debounceService.cancel(conversationId);
          await redis.del(`conv_buffer:${conversationId}`);
          logger.info('Conversation assigned to human agent. Bot silenced.', { correlationId, conversationId, assigneeId });
          return { status: 'processed', action: 'human_assigned', conversationId, assigneeId };
        } else if (!assigneeId) {
          await redis.del(`human_active:${conversationId}`);
          logger.info('Conversation unassigned. Bot reactivated.', { correlationId, conversationId });
          return { status: 'processed', action: 'bot_reactivated', conversationId };
        }
      }
      return { status: 'ignored', reason: 'conversation_event_unhandled' };
    }

    // 1. Event Shield: Only handle message_created for chat processing
    if (payload.event !== 'message_created') {
      logger.info('Event ignored (not message_created)', { correlationId, event: payload.event });
      return { status: 'ignored', reason: 'event_type_not_handled' };
    }

    const message = payload.message || payload;
    const messageId = message.id;
    const sender = message.sender || payload.sender || {};
    const content = (message.content || '').trim();
    const senderType = (sender.type || message.sender_type || payload.sender_type || '').toLowerCase();
    const isHumanAgent = senderType === 'agent' || senderType === 'user';

    // 2. Idempotency Check: Dedup by message_id
    if (messageId) {
      const dedupKey = `msg_processed:${messageId}`;
      const alreadyProcessed = await redis.get(dedupKey);
      if (alreadyProcessed) {
        logger.info('Duplicate message ignored', { correlationId, messageId });
        return { status: 'ignored', reason: 'duplicate_message' };
      }
      await redis.set(dedupKey, '1', 'EX', IDEMPOTENCY_TTL);
    }

    // 3. Human Agent Takeover: If a human agent sends a message, immediately silence the bot
    if (isHumanAgent) {
      logger.info('Human agent message detected. Silencing bot.', { correlationId, conversationId });
      if (conversationId) {
        await redis.set(`human_active:${conversationId}`, '1', 'EX', HUMAN_ACTIVE_TTL);
        debounceService.cancel(conversationId);
        await redis.del(`conv_buffer:${conversationId}`);
      }
      return { status: 'ignored', reason: 'agent_message' };
    }

    // Filter Outgoing or Bot messages (avoid infinite loops)
    if (message.message_type === 'outgoing' || senderType === 'bot') {
      logger.info('Outgoing/bot message ignored', { correlationId });
      return { status: 'ignored', reason: 'bot_or_outgoing_message' };
    }

    // 4. Channel / Inbox Blocking: Check if bot is disabled for this specific channel/inbox
    const channelCheck = await isChannelDisabled(payload, conversation);
    if (channelCheck) {
      logger.info('Bot disabled for channel/inbox. Silencing bot for human attention.', {
        correlationId,
        conversationId,
        match: channelCheck.match,
        channel: channelCheck.channelType || channelCheck.inboxName || channelCheck.inboxId,
      });
      return {
        status: 'ignored',
        reason: 'channel_disabled',
        match: channelCheck.match,
        channel: channelCheck.channelType || channelCheck.inboxName || channelCheck.inboxId,
      };
    }

    // 5. Human Assignment Check: If conversation is currently assigned to a human agent, silence bot
    const assigneeId = conversation.assignee_id || conversation.meta?.assignee?.id || conversation.assignee?.id;
    const botAgentId = await configuracionRepo.get('chatwoot_bot_agent_id');
    if (assigneeId && (!botAgentId || String(assigneeId) !== String(botAgentId))) {
      logger.info('Conversation currently assigned to human agent. Bot silenced.', { correlationId, conversationId, assigneeId });
      if (conversationId) {
        await redis.set(`human_active:${conversationId}`, '1', 'EX', HUMAN_ACTIVE_TTL);
        debounceService.cancel(conversationId);
        await redis.del(`conv_buffer:${conversationId}`);
      }
      return { status: 'ignored', reason: 'assigned_to_human' };
    }

    // 6. Human Active Flag Check in Redis
    if (conversationId) {
      const isHumanActive = await redis.get(`human_active:${conversationId}`);
      if (isHumanActive) {
        logger.info('Human agent active in conversation. Bot silenced.', { correlationId, conversationId });
        return { status: 'ignored', reason: 'human_active' };
      }
    }

    // 7. Mailer Daemon / Bounce Filter
    if (
      content.toLowerCase().includes('mailer-daemon') ||
      content.toLowerCase().includes('mail delivery failed') ||
      content.toLowerCase().includes('undelivered mail')
    ) {
      logger.info('Bounce email ignored', { correlationId });
      return { status: 'ignored', reason: 'bounce_email' };
    }

    if (!content) {
      logger.info('Empty message content ignored', { correlationId });
      return { status: 'ignored', reason: 'empty_content' };
    }

    // 8. E-commerce Order Detection
    const inbox = conversation.inbox || payload.inbox || {};
    const inboxIdentifier = await configuracionRepo.get('ecommerce_inbox_identifier');
    const isEcommerceInbox =
      (inboxIdentifier && inbox.name && inbox.name.toLowerCase().includes(inboxIdentifier.toLowerCase())) ||
      (inboxIdentifier && inbox.id && inbox.id.toString() === inboxIdentifier);

    if (isEcommerceInbox && ecommerceOrderService.looksLikeOrderEmail(content)) {
      logger.info('Ecommerce order email detected', { correlationId, inbox: inbox.name || inbox.id });
      try {
        const result = await ecommerceOrderService.processOrderEmail({
          content,
          conversationId,
          accountId,
          sender,
          messageId,
        });
        return { status: 'processed', action: 'ecommerce_order', ...result };
      } catch (err) {
        logger.error('Error processing ecommerce order', { correlationId, error: err.message });
        // Fall through to normal processing if ecommerce processing fails
      }
    }

    logger.info('Incoming user message', { correlationId, conversationId, contentLength: content.length });

    // Log message to DB
    await conversacionesRepo.logMessage(conversationId, content, 'user');

    // 9. Check Customer Order Cancellation Request
    const lowerContent = content.toLowerCase();
    if (
      lowerContent.includes('ya no lo quiero') ||
      lowerContent.includes('cancelar mi pedido') ||
      lowerContent.includes('cancela el pedido')
    ) {
      const cancelled = await pedidosService.handleCustomerCancellation(conversationId, accountId);
      if (cancelled) {
        return { status: 'processed', action: 'order_cancelled' };
      }
    }

    // 10. Redis Session Memory (History) & Debounce Buffer
    const bufferKey = `conv_buffer:${conversationId}`;
    const lockKey = `conv_lock:${conversationId}`;

    if (process.env.DEBOUNCE_DISABLED !== 'true') {
      const isFirstInWindow = await redis.set(lockKey, '1', 'EX', 4, 'NX');
      if (!isFirstInWindow) {
        // Rapid sequential message received within 4s window -> buffer it
        await redis.rpush(bufferKey, content);
        await redis.expire(lockKey, 4);
        logger.info('Message buffered for debounce', { correlationId, conversationId });
        return { status: 'buffered', conversationId };
      }
    }

    // Retrieve any buffered messages that arrived just before processing
    let fullContent = content;
    const bufferedMessages = await redis.lrange(bufferKey, 0, -1);
    if (bufferedMessages && bufferedMessages.length > 0) {
      fullContent = [content, ...bufferedMessages].join(' ');
      await redis.del(bufferKey);
      logger.info('Buffered messages combined', { correlationId, count: bufferedMessages.length + 1 });
    }

    const sessionKey = `conv_memory:${conversationId}`;
    const rawHistory = (await redis.get(sessionKey)) || '[]';
    let history = JSON.parse(rawHistory);
    history.push({ role: 'user', content: fullContent });

    // Limit context window to last 10 messages
    if (history.length > 10) history = history.slice(-10);

    // 11. RAG Search Context
    const { contextStr } = await ragService.getRelevantContext(fullContent);

    // 12. Assemble System Prompt with Sales & Conversion Guidelines
    const baseSystemPrompt =
      (await configuracionRepo.get('system_prompt')) ||
      'Sos el asistente virtual de Kroser Uruguay. Responde de forma amable, clara y concisa.';

    const fullSystemPrompt = `${baseSystemPrompt}\n\n${contextStr}\nREGLAS IMPORTANTES:
- Si el cliente necesita atención humana específica o si no puedes resolver su duda, responde exactamente con: DERIVAR: [AREA] (donde AREA puede ser: ecommerce, rrhh, administracion, franquicias o info).
- Si el cliente desea comprar o hacer un pedido, colecta su Nombre, Teléfono, Dirección de Entrega y los productos deseados.
- SI UN PRODUCTO CONSULTADO ESTÁ AGOTADO (stock_status = out_of_stock): Ofrece proactivamente las opciones listadas en 'ALTERNATIVAS RECOMENDADAS CON STOCK'.
- VENTA CRUZADA (CROSS-SELLING): Sugiere de forma amigable 1 producto complementario listado en 'SUGERENCIAS DE VENTA CRUZADA' que sea útil para completar el trabajo del cliente.`;

    // 13. Call LLM Service
    const llmReply = await llmService.generateResponse(fullSystemPrompt, history);
    logger.info('LLM reply generated', { correlationId, replyLength: llmReply.length });

    // 14. Check Human Escalation (DERIVAR... pattern)
    if (llmReply.toUpperCase().startsWith('DERIVAR:')) {
      const match = llmReply.match(/DERIVAR:\s*(\w+)/i);
      const area = match ? match[1].toLowerCase() : 'info';

      const assigneeId = (await configuracionRepo.get(`assignee_id_${area}`)) || 1;
      const msgDerivacion =
        (await configuracionRepo.get('msg_derivacion')) ||
        'Te estoy derivando con un asesor humano que va a poder ayudarte mejor.';

      // Silence the bot for future messages in this conversation
      if (conversationId) {
        await redis.set(`human_active:${conversationId}`, '1', 'EX', HUMAN_ACTIVE_TTL);
        debounceService.cancel(conversationId);
        await redis.del(`conv_buffer:${conversationId}`);
      }

      // Assign in Chatwoot & send fixed message
      await chatwootService.assignAgent(accountId, conversationId, assigneeId);
      await chatwootService.sendMessage(accountId, conversationId, msgDerivacion);

      // Send email alert to internal area
      await emailService.sendDerivationAlert({
        area,
        clienteNombre: sender.name,
        clienteTelefono: sender.phone_number,
        clienteMail: sender.email,
        conversationId,
        motivo: content,
      });

      return { status: 'processed', action: 'human_escalation', area };
    }

    // 15. Send Assistant Response to Chatwoot
    await chatwootService.sendMessage(accountId, conversationId, llmReply);
    await conversacionesRepo.logMessage(conversationId, llmReply, 'assistant');

    // Save updated history in Redis with 24h TTL
    history.push({ role: 'assistant', content: llmReply });
    await redis.set(sessionKey, JSON.stringify(history), 'EX', 86400);

    return { status: 'processed', reply: llmReply };
  },
};
