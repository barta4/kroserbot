const redis = require('../../config/redis');
const configuracionRepo = require('../../repositories/configuracionRepository');
const conversacionesRepo = require('../../repositories/conversacionesRepository');
const ragService = require('../embeddings/ragService');
const llmService = require('../llm/llmService');
const chatwootService = require('../chatwoot/chatwootService');
const emailService = require('../email/emailService');
const pedidosService = require('../pedidos/pedidosService');
const ecommerceOrderService = require('../ecommerce/ecommerceOrderService');
const mediaService = require('../media/mediaService');
const intentDetector = require('./intentDetector');
const promptBuilder = require('./promptBuilder');
const customerMemoryService = require('../customer/customerMemoryService');
const guardrailService = require('../guardrails/guardrailService');
const orderTrackingService = require('../pedidos/orderTrackingService');
const debounceService = require('./debounceService');
const logger = require('../../config/logger');

const IDEMPOTENCY_TTL = 3600; // 1 hour
const HUMAN_ACTIVE_TTL = 86400; // 24 hours
const CONTEXT_WINDOW_LIMIT = 20; // Expanded to 20 messages for rich conversation memory

async function isChannelDisabled(payload, conversation) {
  const rawConfig = await configuracionRepo.get('canales_desactivados');
  if (!rawConfig) return false;

  let disabledList = [];
  try {
    const trimmed = rawConfig.trim();
    if (trimmed.startsWith('[')) {
      disabledList = JSON.parse(trimmed);
    } else {
      disabledList = trimmed.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    }
  } catch (_e) {
    disabledList = rawConfig.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  }

  if (!Array.isArray(disabledList) || disabledList.length === 0) return false;

  const normalizedDisabled = disabledList.map((item) => String(item).toLowerCase().trim());

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
    let content = (message.content || '').trim();
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

    // 7. Process Attachments (Multimodal: Audio voice notes & Images / Visual Parts Finder)
    let visualKeywords = [];
    const attachments = message.attachments || payload.attachments || [];
    if (attachments.length > 0) {
      logger.info('Processing message attachments', { correlationId, count: attachments.length });
      try {
        const { mediaSummaries, transcribedTexts, visualSearchTerms } = await mediaService.processMessageAttachments(attachments);
        if (transcribedTexts.length > 0) {
          content = content ? `${content}\n${transcribedTexts.join('\n')}` : transcribedTexts.join('\n');
        } else if (mediaSummaries.length > 0) {
          content = content ? `${content}\n${mediaSummaries.join('\n')}` : mediaSummaries.join('\n');
        }
        if (visualSearchTerms && visualSearchTerms.length > 0) {
          visualKeywords = visualSearchTerms;
        }
      } catch (mediaErr) {
        logger.warn('Error processing attachments in webhook', { correlationId, error: mediaErr.message });
      }
    }

    // 8. Mailer Daemon / Bounce Filter
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

    // 9. E-commerce Order Detection
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
      }
    }

    logger.info('Incoming user message', { correlationId, conversationId, contentLength: content.length });

    // Log message to DB
    await conversacionesRepo.logMessage(conversationId, content, 'user');

    // 10. Intent & Emotion Detection
    const intentResult = intentDetector.detectIntent(content);
    logger.info('Intent detected', { correlationId, intent: intentResult.intent, emotion: intentResult.emotion });

    // 11. Check Customer Order Cancellation Request
    if (intentResult.isCancellation) {
      const cancelled = await pedidosService.handleCustomerCancellation(conversationId, accountId);
      if (cancelled) {
        return { status: 'processed', action: 'order_cancelled' };
      }
    }

    // 12. Redis Session Memory & Debounce Buffer
    const bufferKey = `conv_buffer:${conversationId}`;
    const lockKey = `conv_lock:${conversationId}`;

    if (process.env.DEBOUNCE_DISABLED !== 'true') {
      const isFirstInWindow = await redis.set(lockKey, '1', 'EX', 4, 'NX');
      if (!isFirstInWindow) {
        // Rapid sequential message received within debounce window -> buffer it
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
      fullContent = [content, ...bufferedMessages].join('\n');
      await redis.del(bufferKey);
      logger.info('Buffered messages combined', { correlationId, count: bufferedMessages.length + 1 });
    }

    // 13. Safety & Guardrails: Filter abuse, prompt injections, off-topic spam and floods
    const guardrail = await guardrailService.evaluateInput({
      text: fullContent,
      conversationId,
      sender,
    });

    if (guardrail.isBlocked) {
      logger.warn('Webhook message intercepted by safety guardrail', {
        correlationId,
        conversationId,
        category: guardrail.category,
      });

      if (guardrail.shouldEscalate) {
        const area = guardrail.escalationArea || 'info';
        const assigneeId = (await configuracionRepo.get(`assignee_id_${area}`)) || 1;
        const msgDerivacion =
          (await configuracionRepo.get('msg_derivacion')) ||
          'Le estamos derivando con un asesor especializado que podrá brindarle una atención personalizada. Por favor aguarde un instante.';

        if (conversationId) {
          await redis.set(`human_active:${conversationId}`, '1', 'EX', HUMAN_ACTIVE_TTL);
          debounceService.cancel(conversationId);
          await redis.del(`conv_buffer:${conversationId}`);
        }

        await chatwootService.assignAgent(accountId, conversationId, assigneeId);
        await chatwootService.sendMessage(accountId, conversationId, msgDerivacion);

        await emailService.sendDerivationAlert({
          area,
          clienteNombre: sender.name,
          clienteTelefono: sender.phone_number,
          clienteMail: sender.email,
          conversationId,
          motivo: guardrail.reason || 'Guardrail de seguridad activado por conducta reiterada',
        });

        return { status: 'processed', action: 'guardrail_escalation', category: guardrail.category };
      }

      // Send firm, respectful guardrail response
      await chatwootService.toggleTypingStatus(accountId, conversationId, 'on');
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 300) + 400));
      await chatwootService.toggleTypingStatus(accountId, conversationId, 'off');

      await chatwootService.sendMessage(accountId, conversationId, guardrail.reply);
      await conversacionesRepo.logMessage(conversationId, guardrail.reply, 'assistant');

      const sessionKey = `conv_memory:${conversationId}`;
      const rawHistory = (await redis.get(sessionKey)) || '[]';
      let history = JSON.parse(rawHistory);
      history.push({ role: 'user', content: fullContent });
      history.push({ role: 'assistant', content: guardrail.reply });
      await redis.set(sessionKey, JSON.stringify(history), 'EX', 86400);

      return {
        status: 'processed',
        action: 'guardrail_blocked',
        category: guardrail.category,
        reply: guardrail.reply,
      };
    }

    const sessionKey = `conv_memory:${conversationId}`;
    const rawHistory = (await redis.get(sessionKey)) || '[]';
    let history = JSON.parse(rawHistory);

    // 14. Smart Instant Handling for Pure Greetings & Farewells (Efficiency + Natural Variety)
    if (intentResult.isPureGreeting && history.length <= 1) {
      const greetingReply = intentResult.getGreetingMessage(sender.name);
      
      // Simulate realistic typing indicator and slight delay
      await chatwootService.toggleTypingStatus(accountId, conversationId, 'on');
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 400) + 400));
      await chatwootService.toggleTypingStatus(accountId, conversationId, 'off');

      await chatwootService.sendMessage(accountId, conversationId, greetingReply);
      await conversacionesRepo.logMessage(conversationId, greetingReply, 'assistant');

      history.push({ role: 'user', content: fullContent });
      history.push({ role: 'assistant', content: greetingReply });
      await redis.set(sessionKey, JSON.stringify(history), 'EX', 86400);

      logger.info('Pure greeting handled directly with formal time-of-day greeting', { correlationId });
      return { status: 'processed', action: 'pure_greeting', reply: greetingReply };
    }

    if (intentResult.isPureFarewell && history.length > 0) {
      const farewellReply = intentResult.getFarewellMessage();

      // Simulate realistic typing indicator and slight delay
      await chatwootService.toggleTypingStatus(accountId, conversationId, 'on');
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 400) + 400));
      await chatwootService.toggleTypingStatus(accountId, conversationId, 'off');

      await chatwootService.sendMessage(accountId, conversationId, farewellReply);
      await conversacionesRepo.logMessage(conversationId, farewellReply, 'assistant');

      history.push({ role: 'user', content: fullContent });
      history.push({ role: 'assistant', content: farewellReply });
      await redis.set(sessionKey, JSON.stringify(history), 'EX', 86400);

      logger.info('Pure farewell handled directly with formal closing', { correlationId });
      return { status: 'processed', action: 'pure_farewell', reply: farewellReply };
    }

    // Add current user message to conversation history
    history.push({ role: 'user', content: fullContent });

    // 14. Expand Context Window & Handle Summarization if Long
    let processedHistory = history;
    if (history.length > CONTEXT_WINDOW_LIMIT) {
      const olderMessages = history.slice(0, history.length - 12);
      const recentMessages = history.slice(-12);
      const summarySnippet = olderMessages
        .map((m) => `${m.role === 'user' ? 'Cliente' : 'Asesor'}: ${m.content}`)
        .join(' | ')
        .substring(0, 300);

      processedHistory = [
        {
          role: 'system',
          content: `[Resumen de la conversación previa: ${summarySnippet}]`,
        },
        ...recentMessages,
      ];
    }

    // 15. Cross-Conversation Memory & Customer Profile Context
    const customerMemory = await customerMemoryService.getCustomerProfileContext({
      conversationId,
      sender,
      clientPayload: payload.contact,
    });

    // 15b. Order Tracking Self-Service Check
    let trackingContextStr = '';
    const hasOrderTrackingIntent = intentResult.isTracking || intentResult.intent === 'tracking_pedido' || /#\s*[0-9]{1,8}/.test(fullContent);
    if (hasOrderTrackingIntent) {
      const trackingResult = await orderTrackingService.getTrackingInfo({
        text: fullContent,
        conversationId,
        sender,
        clientPayload: payload.contact,
      });
      if (trackingResult.hasOrder && trackingResult.contextStr) {
        trackingContextStr = trackingResult.contextStr;
        logger.info('Order tracking context retrieved for prompt', {
          correlationId,
          orderRef: trackingResult.orderRef,
          status: trackingResult.status,
        });
      }
    }

    // 16. RAG Semantic & Catalog Search (enriches with visual keywords if available)
    const ragQuery = visualKeywords.length > 0 ? `${fullContent} ${visualKeywords.join(' ')}` : fullContent;
    const { contextStr } = await ragService.getRelevantContext(ragQuery);

    // 17. Build Dynamic, Humanized, and Formal System Prompt
    const fullSystemPrompt = await promptBuilder.buildSystemPrompt({
      ragContextStr: contextStr,
      customerProfileStr: customerMemory.contextStr,
      trackingContextStr,
      detectedEmotion: intentResult.emotion,
      messageCount: history.length,
      customerName: sender.name,
    });

    // 18. Call LLM with Typing Indicator & Measured Human Delay
    await chatwootService.toggleTypingStatus(accountId, conversationId, 'on');
    const startLlmTime = Date.now();

    const llmReply = await llmService.generateResponse(fullSystemPrompt, processedHistory);
    const llmElapsed = Date.now() - startLlmTime;

    logger.info('LLM reply generated', { correlationId, replyLength: llmReply.length, llmElapsedMs: llmElapsed });

    // 19. Check Human Escalation (DERIVAR... pattern)
    if (llmReply.toUpperCase().startsWith('DERIVAR:')) {
      const match = llmReply.match(/DERIVAR:\s*(\w+)/i);
      const area = match ? match[1].toLowerCase() : 'info';

      const assigneeId = (await configuracionRepo.get(`assignee_id_${area}`)) || 1;
      const msgDerivacion =
        (await configuracionRepo.get('msg_derivacion')) ||
        'Le estamos derivando con un asesor especializado que podrá brindarle una atención personalizada. Por favor aguarde un instante.';

      // Silence the bot for future messages in this conversation
      if (conversationId) {
        await redis.set(`human_active:${conversationId}`, '1', 'EX', HUMAN_ACTIVE_TTL);
        debounceService.cancel(conversationId);
        await redis.del(`conv_buffer:${conversationId}`);
      }

      await chatwootService.toggleTypingStatus(accountId, conversationId, 'off');

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

    // 20. Output Guardrails Filter: Sanitize against prompt/secret leakage
    let safeReply = guardrailService.filterOutput(llmReply);

    // 21. Automatic Order Extraction & Creation
    const orderExtractor = require('../pedidos/orderExtractor');
    const { cleanReply, createdOrder } = await orderExtractor.processOrderFromReply({
      rawReply: safeReply,
      history,
      conversationId,
      accountId,
      channel: conversation.channel || 'chatwoot',
    });
    safeReply = cleanReply;

    if (createdOrder) {
      logger.info('Order successfully created from webhook conversation', {
        pedidoId: createdOrder.id,
        conversationId,
        cliente: createdOrder.cliente,
      });
    }

    // 22. Human Typing Delay: calculate natural pacing based on response length
    // (e.g., ~15-20ms per character, bounded between 1s and 3.5s total typing illusion)
    const targetTypingDelay = Math.min(Math.max(safeReply.length * 15, 800), 3000) + Math.floor(Math.random() * 300);
    const remainingDelay = targetTypingDelay - llmElapsed;
    if (remainingDelay > 0 && process.env.NODE_ENV !== 'test') {
      await new Promise((resolve) => setTimeout(resolve, remainingDelay));
    }

    // Turn off typing indicator
    await chatwootService.toggleTypingStatus(accountId, conversationId, 'off');

    // 22. Send Assistant Response to Chatwoot & Persist Session
    await chatwootService.sendMessage(accountId, conversationId, safeReply);
    await conversacionesRepo.logMessage(conversationId, safeReply, 'assistant');

    // Save updated history in Redis with 24h TTL
    history.push({ role: 'assistant', content: safeReply });
    if (history.length > 30) history = history.slice(-25);
    await redis.set(sessionKey, JSON.stringify(history), 'EX', 86400);

    return { status: 'processed', reply: safeReply };
  },
};
