const redis = require('../../config/redis');
const configuracionRepo = require('../../repositories/configuracionRepository');
const conversacionesRepo = require('../../repositories/conversacionesRepository');
const llmService = require('../llm/llmService');
const chatwootService = require('../chatwoot/chatwootService');
const pedidosService = require('../pedidos/pedidosService');
const ecommerceOrderService = require('../ecommerce/ecommerceOrderService');
const intentDetector = require('./intentDetector');
const promptBuilder = require('./promptBuilder');
const customerMemoryService = require('../customer/customerMemoryService');
const guardrailService = require('../guardrails/guardrailService');
const botLoopDetector = require('../guardrails/botLoopDetector');
const orderTrackingService = require('../pedidos/orderTrackingService');
const debounceService = require('./debounceService');
const logger = require('../../config/logger');
const orderExtractor = require('../pedidos/orderExtractor');
const autoResolveService = require('../chatwoot/autoResolveService');
const messageSplitter = require('../../utils/messageSplitter');
const channelPolicyService = require('../channel/channelPolicy');

// Modular pipeline handlers
const webhookLifecycle = require('./webhookLifecycleHandler');
const webhookMedia = require('./webhookMediaHandler');
const webhookEscalation = require('./webhookEscalationHandler');

const IDEMPOTENCY_TTL = 3600; // 1 hour
const HUMAN_ACTIVE_TTL = 86400; // 24 hours
const CONTEXT_WINDOW_LIMIT = 20; // Expanded to 20 messages for rich conversation memory

function safeParseHistory(rawHistory) {
  if (!rawHistory) return [];
  try {
    const parsed = JSON.parse(rawHistory);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_err) {
    logger.warn('Error al parsear historial de Redis, reiniciando historial', { error: _err.message });
    return [];
  }
}

async function releaseLockAndDrainBuffer(lockKey, bufferKey, conversationId, payload, processFn) {
  if (!lockKey || payload._alreadyDebounced) return;
  try {
    await redis.del(lockKey);
    const remainingBuffered = await redis.lrange(bufferKey, 0, -1);
    if (remainingBuffered && remainingBuffered.length > 0) {
      await redis.del(bufferKey);
      const nextContent = remainingBuffered.join('\n');
      const recursionDepth = payload._recursionDepth || 0;
      if (recursionDepth < 2 && processFn) {
        setImmediate(async () => {
          try {
            await processFn({
              ...payload,
              _alreadyDebounced: true,
              _recursionDepth: recursionDepth + 1,
              message: {
                ...(payload.message || {}),
                content: nextContent,
              },
            });
          } catch (err) {
            logger.error('Error processing subsequent buffered messages', { conversationId, error: err.message });
          }
        });
      } else {
        logger.warn('Max webhook recursion depth reached, discarding remaining buffer', {
          conversationId,
          droppedCount: remainingBuffered.length,
        });
      }
    }
  } catch (err) {
    logger.warn('Error releasing lock and draining buffer', { conversationId, error: err.message });
  }
}

module.exports = {
  async processWebhookEvent(payload) {
    const correlationId = `conv_${payload.conversation?.id || 'unknown'}_${Date.now()}`;
    logger.info('Webhook event received', { correlationId, event: payload.event });

    const conversation = payload.conversation || {};
    const rawChannel = (
      conversation.channel ||
      conversation.inbox?.channel_type ||
      payload.inbox?.channel_type ||
      payload.channel ||
      payload.channel_type ||
      'whatsapp'
    ).toLowerCase();
    const channelPolicy = channelPolicyService.resolveChannelPolicy(rawChannel);
    const conversationId = conversation.id || payload.conversation_id;
    const accountId = payload.account?.id || conversation.account_id || 1;
    const botAgentId = await chatwootService.getBotAgentId();

    // 0. Handle Conversation Assignment & Status Changes (Chatwoot conversation_updated / conversation_status_changed)
    if (payload.event === 'conversation_updated' || payload.event === 'conversation_status_changed') {
      return await webhookLifecycle.handleConversationEvent(payload, { correlationId, botAgentId });
    }

    const message = payload.message || payload;
    const attachments = (Array.isArray(message.attachments) && message.attachments.length > 0)
      ? message.attachments
      : (Array.isArray(payload.attachments) && payload.attachments.length > 0)
        ? payload.attachments
        : [];
    const isMessageEvent =
      payload.event === 'message_created' ||
      (payload.event === 'message_updated' && Array.isArray(attachments) && attachments.length > 0);

    // 1. Event Shield: Only handle message_created or message_updated with attachments
    if (!isMessageEvent) {
      logger.info('Event ignored (not message_created or message_updated with attachments)', { correlationId, event: payload.event });
      return { status: 'ignored', reason: 'event_type_not_handled' };
    }

    const messageId = message.id || payload.id;
    const sender = message.sender || payload.sender || {};
    let content = (message.content || payload.content || '').trim();
    const senderType = (sender.type || message.sender_type || payload.sender_type || '').toLowerCase();
    const messageType = String(message.message_type || payload.message_type || '').toLowerCase();
    const isPrivate = Boolean(message.private || payload.private);

    // 1b. Ignore internal private notes from customer chat processing
    if (isPrivate) {
      logger.info('Private internal note ignored', { correlationId, messageId });
      return { status: 'ignored', reason: 'private_note' };
    }

    // 1c. If incoming message has NO content and NO attachments, it is an empty stub waiting for media download
    if (!content && (!Array.isArray(attachments) || attachments.length === 0)) {
      logger.info('Empty message content without attachments ignored (waiting for media download)', { correlationId, messageId });
      return { status: 'ignored', reason: 'empty_content' };
    }

    // 2. Idempotency Check: Atomic dedup by message_id with SET NX
    if (messageId) {
      const dedupKey = `msg_processed:${messageId}`;
      const isNew = await redis.set(dedupKey, '1', 'EX', IDEMPOTENCY_TTL, 'NX');
      if (!isNew) {
        logger.info('Duplicate message ignored', { correlationId, messageId });
        return { status: 'ignored', reason: 'duplicate_message' };
      }
    }

    const isOutgoing = messageType === 'outgoing' || messageType === '1';

    // 2b. Outgoing Message Handling: Bot Self-Message vs Human Agent Takeover
    if (isOutgoing) {
      return await webhookLifecycle.handleOutgoingMessage(payload, {
        correlationId,
        conversationId,
        botAgentId,
        message,
        messageId,
        sender,
        senderType,
        content,
      });
    }

    // Active customer message: cancel any pending auto-resolve for this conversation
    if (conversationId) {
      autoResolveService.cancelScheduledResolve(conversationId);
    }

    // 4. Channel / Inbox Blocking: Check if bot is disabled for this specific channel/inbox
    const channelCheck = await webhookLifecycle.isChannelDisabled(payload, conversation);
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

    // 5 & 6. Human Assignment & Human Active Flag Check
    const humanCheck = await webhookLifecycle.checkHumanActive({
      conversation,
      conversationId,
      botAgentId,
      correlationId,
    });
    if (humanCheck.isHuman) {
      return { status: 'ignored', reason: humanCheck.reason };
    }

    // 6b. Bot Loop Shield: Server Bounce & No-Reply Filter (noreply & bounce handling)
    const bounceCheck = await webhookLifecycle.handleServerBounceAndNoReply({
      payload,
      conversationId,
      accountId,
      correlationId,
    });
    if (bounceCheck.handled) {
      return bounceCheck.result;
    }

    // 7 & 7b. Process Attachments (Multimodal) and URLs
    let visualKeywords = [];
    const mediaResult = await webhookMedia.processAttachmentsAndUrls(content, attachments, { correlationId });
    content = mediaResult.content;
    visualKeywords = mediaResult.visualKeywords;

    // 8. Mailer Daemon / Bounce Filter (Fallback)
    const secondaryBounceCheck = botLoopDetector.isServerBounce(content);
    if (secondaryBounceCheck) {
      logger.info('Bounce email ignored by fallback filter. Applying Shield.', { correlationId, conversationId });
      if (conversationId) {
        await redis.set(`human_active:${conversationId}`, '1', 'EX', HUMAN_ACTIVE_TTL);
        debounceService.cancel(conversationId);
        await redis.del(`conv_buffer:${conversationId}`);
        await botLoopDetector.resetTurns(conversationId);
        autoResolveService.cancelScheduledResolve(conversationId);
      }
      if (conversationId && accountId) {
        await chatwootService.addPrivateNote(
          accountId,
          conversationId,
          `🛑 [Auto-Shield] Rebote de servidor detectado en cuerpo de mensaje. Bot silenciado.`
        );
        await chatwootService.addLabels(accountId, conversationId, ['rebote-email', 'auto-shield']);
      }
      return {
        status: 'ignored',
        reason: 'server_bounce_shield_applied',
        shieldApplied: true,
        conversationId,
      };
    }

    // 8b. Bot Loop Shield: Auto-responder & IVR Menu Early Drop Filter
    const autoResponderCheck = botLoopDetector.isAutoResponderOrIVR(content);
    if (autoResponderCheck) {
      logger.info('External auto-responder / bot message dropped silently', {
        correlationId,
        conversationId,
        category: autoResponderCheck.category,
        pattern: autoResponderCheck.matchedPattern,
      });
      if (conversationId && accountId) {
        await chatwootService.addPrivateNote(
          accountId,
          conversationId,
          `ℹ️ [Auto-Shield] Se detectó respuesta automática externa (${autoResponderCheck.category}). El bot no responderá para evitar un bucle.`
        );
      }
      return {
        status: 'ignored',
        reason: 'auto_responder_detected',
        category: autoResponderCheck.category,
      };
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
    let intentResult = intentDetector.detectIntent(content);
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

    if (process.env.DEBOUNCE_DISABLED !== 'true' && !payload._alreadyDebounced) {
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
      // Re-evaluate intent on the combined message so inquiries following a greeting are not swallowed
      intentResult = intentDetector.detectIntent(fullContent);
    }

    // Bound user message length right away to prevent context & memory explosion
    const MAX_USER_MSG_CHARS = 2500;
    if (fullContent && fullContent.length > MAX_USER_MSG_CHARS) {
      fullContent = fullContent.slice(0, MAX_USER_MSG_CHARS) + '\n... [Mensaje truncado por longitud]';
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
        const channel = (
          conversation.channel ||
          conversation.inbox?.channel_type ||
          payload.inbox?.channel_type ||
          payload.channel ||
          payload.channel_type ||
          'whatsapp'
        ).toLowerCase();

        const escResult = await webhookEscalation.handleEscalation({
          area,
          reason: guardrail.reason || 'Guardrail de seguridad activado por conducta reiterada',
          sender,
          conversationId,
          accountId,
          channel,
          history: [{ role: 'user', content: fullContent }],
          ragContextStr: '',
          actionName: 'guardrail_escalation',
        });

        await releaseLockAndDrainBuffer(lockKey, bufferKey, conversationId, payload, module.exports.processWebhookEvent);
        return { status: 'processed', action: 'guardrail_escalation', category: guardrail.category, isOutOfHours: escResult.isOutOfHours };
      }

      // Send firm, respectful guardrail response
      await chatwootService.toggleTypingStatus(accountId, conversationId, 'on');
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 300) + 400));
      await chatwootService.toggleTypingStatus(accountId, conversationId, 'off');

      await chatwootService.sendMessage(accountId, conversationId, guardrail.reply);
      await conversacionesRepo.logMessage(conversationId, guardrail.reply, 'assistant');

      const sessionKey = `conv_memory:${conversationId}`;
      const rawHistory = await redis.get(sessionKey);
      let history = safeParseHistory(rawHistory);
      history.push({ role: 'user', content: fullContent });
      history.push({ role: 'assistant', content: guardrail.reply });
      await redis.set(sessionKey, JSON.stringify(history), 'EX', 86400);

      await releaseLockAndDrainBuffer(lockKey, bufferKey, conversationId, payload, module.exports.processWebhookEvent);
      return {
        status: 'processed',
        action: 'guardrail_blocked',
        category: guardrail.category,
        reply: guardrail.reply,
      };
    }

    const sessionKey = `conv_memory:${conversationId}`;
    const rawHistory = await redis.get(sessionKey);
    let history = safeParseHistory(rawHistory);

    // Fallback: If Redis session expired or cache was evicted, hydrate from persistent DB
    if (history.length === 0 && conversationId) {
      try {
        const dbHistory = await conversacionesRepo.getHistory(conversationId, CONTEXT_WINDOW_LIMIT);
        if (dbHistory && dbHistory.length > 0) {
          history = dbHistory.map((m) => ({
            role: (m.rol === 'assistant' || m.rol === 'model') ? 'assistant' : 'user',
            content: m.mensaje,
          }));
          logger.info('History hydrated from PostgreSQL database backup', {
            conversationId,
            messageCount: history.length,
          });
        }
      } catch (dbErr) {
        logger.warn('Failed to hydrate history from database', { error: dbErr.message });
      }
    }

    // 13b. Bot Loop Shield: Suppress farewell if assistant already closed the conversation to prevent politeness spiral
    if (botLoopDetector.shouldSuppressFarewell(history, fullContent)) {
      logger.info('Farewell suppressed to prevent politeness spiral loop', { correlationId, conversationId });
      history.push({ role: 'user', content: fullContent });
      await redis.set(sessionKey, JSON.stringify(history), 'EX', 86400);
      await releaseLockAndDrainBuffer(lockKey, bufferKey, conversationId, payload, module.exports.processWebhookEvent);
      return { status: 'ignored', reason: 'farewell_loop_prevented' };
    }

    // 14. Smart Instant Handling for Pure Greetings & Farewells (Efficiency + Natural Variety)
    if (intentResult.isPureGreeting && history.length <= 1) {
      const greetingReply = intentResult.getGreetingMessage(sender.name);

      await chatwootService.toggleTypingStatus(accountId, conversationId, 'on');
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 400) + 400));
      await chatwootService.toggleTypingStatus(accountId, conversationId, 'off');

      await chatwootService.sendMessage(accountId, conversationId, greetingReply);
      await conversacionesRepo.logMessage(conversationId, greetingReply, 'assistant');

      history.push({ role: 'user', content: fullContent });
      history.push({ role: 'assistant', content: greetingReply });
      await redis.set(sessionKey, JSON.stringify(history), 'EX', 86400);

      await releaseLockAndDrainBuffer(lockKey, bufferKey, conversationId, payload, module.exports.processWebhookEvent);
      logger.info('Pure greeting handled directly with formal time-of-day greeting', { correlationId });
      return { status: 'processed', action: 'pure_greeting', reply: greetingReply };
    }

    if (intentResult.isPureFarewell && history.length > 0) {
      const farewellReply = intentResult.getFarewellMessage();

      await chatwootService.toggleTypingStatus(accountId, conversationId, 'on');
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 400) + 400));
      await chatwootService.toggleTypingStatus(accountId, conversationId, 'off');

      await chatwootService.sendMessage(accountId, conversationId, farewellReply);
      await conversacionesRepo.logMessage(conversationId, farewellReply, 'assistant');

      history.push({ role: 'user', content: fullContent });
      history.push({ role: 'assistant', content: farewellReply });
      await redis.set(sessionKey, JSON.stringify(history), 'EX', 86400);

      // Auto-resolve immediately on farewell if enabled
      const autoResolveFarewell = (await configuracionRepo.get('auto_resolve_on_farewell')) !== 'false';
      if (autoResolveFarewell) {
        await autoResolveService.resolveImmediately(accountId, conversationId, 'farewell');
      }

      await releaseLockAndDrainBuffer(lockKey, bufferKey, conversationId, payload, module.exports.processWebhookEvent);
      logger.info('Pure farewell handled directly with formal closing', { correlationId, autoResolved: autoResolveFarewell });
      return { status: 'processed', action: 'pure_farewell', reply: farewellReply, autoResolved: autoResolveFarewell };
    }

    // Add current user message to conversation history
    history.push({ role: 'user', content: fullContent });

    // 14. Expand Context Window & Handle Summarization if Long
    let processedHistory = history;
    let conversationSummaryStr = '';
    if (history.length > CONTEXT_WINDOW_LIMIT) {
      const olderMessages = history.slice(0, history.length - 12);
      let recentMessages = history.slice(-12);

      if (recentMessages.length > 0 && recentMessages[0].role === 'assistant') {
        recentMessages = recentMessages.slice(1);
      }

      conversationSummaryStr = olderMessages
        .map((m) => `${m.role === 'user' ? 'Cliente' : 'Asesor'}: ${m.content}`)
        .join(' | ')
        .slice(-600);

      processedHistory = recentMessages;
    }

    // 15. Cross-Conversation Memory & Customer Profile Context
    const customerMemory = await customerMemoryService.getCustomerProfileContext({
      conversationId,
      sender,
      clientPayload: payload.contact,
    });

    // 15b. Order Tracking Self-Service Check
    let trackingContextStr = '';
    const hasOrderTrackingIntent = intentResult.isTracking || intentResult.intent === 'tracking_pedido' || /(?:pedido|orden|compra|seguimiento|ref|rastreo)\s*#?\s*[0-9]{1,8}\b|#\s*[0-9]{4,8}\b/i.test(fullContent);
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

    // 15c. Bot Loop Shield: Check Repetitive Message Loop
    const repetitionCheck = await botLoopDetector.checkAndTrackRepetition(conversationId, fullContent);
    if (repetitionCheck.isLoop) {
      logger.warn('Repetitive message loop detected. Pausing bot for conversation', { correlationId, conversationId });
      if (conversationId) {
        await redis.set(`human_active:${conversationId}`, '1', 'EX', HUMAN_ACTIVE_TTL);
        debounceService.cancel(conversationId);
        await redis.del(`conv_buffer:${conversationId}`);
      }
      if (conversationId && accountId) {
        await chatwootService.addPrivateNote(
          accountId,
          conversationId,
          '⚠️ [Auto-Shield] Bucle repetitivo detectado (el interlocutor envió el mismo mensaje 3 veces seguidas). Bot pausado para revisión humana.'
        );
      }
      await releaseLockAndDrainBuffer(lockKey, bufferKey, conversationId, payload, module.exports.processWebhookEvent);
      return { status: 'processed', action: 'repetitive_loop_blocked', conversationId };
    }

    // 15d. Bot Loop Shield: Turn Limit Circuit Breaker (Max bot interactions before human handoff)
    const turnCheck = await botLoopDetector.checkAndIncrementTurns(conversationId);
    if (turnCheck.isLimitReached) {
      logger.warn('Bot turn limit reached. Triggering circuit breaker', {
        correlationId,
        conversationId,
        turnCount: turnCheck.turnCount,
        maxTurns: turnCheck.maxTurns,
      });

      const limitMsg =
        (await configuracionRepo.get('msg_limite_turnos')) ||
        'Hemos alcanzado el límite de respuestas automáticas para esta consulta. En breve un asesor de nuestro equipo continuará la atención personalizada.';

      if (conversationId) {
        await redis.set(`human_active:${conversationId}`, '1', 'EX', HUMAN_ACTIVE_TTL);
        debounceService.cancel(conversationId);
        await redis.del(`conv_buffer:${conversationId}`);
        autoResolveService.cancelScheduledResolve(conversationId);
      }

      await chatwootService.sendMessage(accountId, conversationId, limitMsg);
      await conversacionesRepo.logMessage(conversationId, limitMsg, 'assistant');

      if (conversationId && accountId) {
        await chatwootService.addPrivateNote(
          accountId,
          conversationId,
          `🛑 [Auto-Shield] Se alcanzó el límite de ${turnCheck.maxTurns} turnos automáticos en esta conversación. Bot pausado para atención humana.`
        );
      }

      await releaseLockAndDrainBuffer(lockKey, bufferKey, conversationId, payload, module.exports.processWebhookEvent);
      return { status: 'processed', action: 'turn_limit_reached', turnCount: turnCheck.turnCount };
    }

    // 16. Build Dynamic, Humanized, Lightweight System Prompt (No unconditional RAG)
    let quotedProductsStr = '';
    if (conversationId) {
      try {
        const rawQuoted = await redis.get(`conv_last_quoted:${conversationId}`);
        if (rawQuoted) {
          const quotedList = JSON.parse(rawQuoted);
          if (Array.isArray(quotedList) && quotedList.length > 0) {
            quotedProductsStr = quotedList
              .map(
                (p, idx) =>
                  `${idx + 1}. ${p.nombre} (SKU: ${p.sku}) - Precio: ${p.precio}${p.marca ? ` - Marca: ${p.marca}` : ''}`
              )
              .join('\n');
          }
        }
      } catch (qErr) {
        logger.warn('Error reading conv_last_quoted from Redis', { error: qErr.message, conversationId });
      }
    }

    const fullSystemPrompt = await promptBuilder.buildSystemPrompt({
      customerProfileStr: customerMemory.contextStr,
      trackingContextStr,
      conversationSummaryStr,
      quotedProductsStr,
      detectedEmotion: intentResult.emotion,
      detectedIntent: intentResult.intent,
      messageCount: history.length,
      customerName: sender.name,
      channelPolicy,
    });

    // 17. Call LLM with Agentic Tools & Typing Indicator Active
    if (lockKey && !payload._alreadyDebounced) {
      await redis.expire(lockKey, 25);
    }
    await chatwootService.toggleTypingStatus(accountId, conversationId, 'on');
    const startLlmTime = Date.now();

    const toolContext = {
      conversationId,
      accountId,
      channel: rawChannel,
      channelPolicy,
      sender,
      lastUserMessage: fullContent,
    };

    const { reply: llmReply, toolsUsed, createdOrder: toolCreatedOrder } = await llmService.generateWithTools(
      fullSystemPrompt,
      processedHistory,
      { toolContext }
    );
    const llmElapsed = Date.now() - startLlmTime;

    // Cache quoted products from buscar_productos in Redis for anaphoric resolution in subsequent turns
    if (conversationId && toolsUsed && toolsUsed.length > 0) {
      try {
        const prodTool = toolsUsed.find(
          (t) =>
            t.name === 'buscar_productos' &&
            t.result &&
            Array.isArray(t.result.productos) &&
            t.result.productos.length > 0
        );
        if (prodTool) {
          const itemsToCache = prodTool.result.productos.slice(0, 3).map((p) => ({
            sku: p.sku,
            nombre: p.nombre,
            precio: p.precio,
            marca: p.marca,
            enlace_web: p.enlace_web,
          }));
          await redis.set(`conv_last_quoted:${conversationId}`, JSON.stringify(itemsToCache), 'EX', 86400);
        }
      } catch (cacheErr) {
        logger.warn('Error caching quoted products to Redis', { error: cacheErr.message, conversationId });
      }
    }

    logger.info('LLM reply generated with tools', {
      correlationId,
      replyLength: llmReply.length,
      llmElapsedMs: llmElapsed,
      toolsCount: toolsUsed.length,
    });

    // 18. Check Human Escalation (DERIVAR... pattern)
    if (/DERIVAR:\s*\[?(\w+)\]?/i.test(llmReply)) {
      const match = llmReply.match(/DERIVAR:\s*\[?(\w+)\]?/i);
      const area = match ? match[1].toLowerCase() : 'info';
      const channel = (
        conversation.channel ||
        conversation.inbox?.channel_type ||
        payload.inbox?.channel_type ||
        payload.channel ||
        payload.channel_type ||
        'whatsapp'
      ).toLowerCase();

      const escResult = await webhookEscalation.handleEscalation({
        area,
        reason: content,
        sender,
        conversationId,
        accountId,
        channel,
        history,
        ragContextStr: toolsUsed.length > 0 ? JSON.stringify(toolsUsed) : '',
        actionName: 'human_escalation',
      });

      // Persist escalation or out-of-hours response in Redis memory
      history.push({ role: 'assistant', content: escResult.msgToSend });
      if (history.length > CONTEXT_WINDOW_LIMIT) {
        history = history.slice(-CONTEXT_WINDOW_LIMIT);
        if (history.length > 0 && history[0].role === 'assistant') {
          history = history.slice(1);
        }
      }
      await redis.set(sessionKey, JSON.stringify(history), 'EX', 86400);

      await releaseLockAndDrainBuffer(lockKey, bufferKey, conversationId, payload, module.exports.processWebhookEvent);
      return {
        status: escResult.status,
        action: escResult.action,
        area: escResult.area,
        isOutOfHours: escResult.isOutOfHours,
        reason: escResult.reason,
      };
    }

    // 19. Output Guardrails Filter: Sanitize against prompt/secret leakage
    let safeReply = guardrailService.filterOutput(llmReply);

    // 20. Automatic Order Extraction & Creation (Priority to Tool Created Order, fallback to heuristic)
    let createdOrder = toolCreatedOrder;
    if (!createdOrder) {
      const { cleanReply, createdOrder: parsedOrder } = await orderExtractor.processOrderFromReply({
        rawReply: safeReply,
        history,
        conversationId,
        accountId,
        channel: conversation.channel || 'chatwoot',
      });
      safeReply = cleanReply;
      createdOrder = parsedOrder;
    }

    if (createdOrder) {
      await botLoopDetector.resetTurns(conversationId);
      logger.info('Order confirmed in webhook conversation', {
        pedidoId: createdOrder.id,
        conversationId,
        cliente: createdOrder.cliente,
      });
    }

    // 21. WhatsApp Cost-Optimized Single Message Delivery (Anti-Spam & Meta Pricing Optimization)
    let replyToSend = (safeReply || '').trim();
    if (!replyToSend) {
      replyToSend = 'Disculpe, ¿en qué producto o consulta técnica podemos ayudarle?';
    }
    replyToSend = channelPolicyService.clampReply(replyToSend, channelPolicy);

    const chunkingConfig = await configuracionRepo.get('message_chunking_enabled');
    // WhatsApp: un solo mensaje siempre, independientemente del chunking configurado.
    const isChunkingEnabled = channelPolicy.id !== 'whatsapp' && chunkingConfig === 'true';

    const rawChunks = isChunkingEnabled
      ? messageSplitter.splitIntoChunks(replyToSend, 2)
      : [replyToSend];
    const chunks = rawChunks.length > 0 ? rawChunks : [replyToSend];

    // Initial human pacing before first message (if LLM was unusually fast)
    const initialDelay = process.env.NODE_ENV !== 'test'
      ? Math.max(0, Math.min((chunks[0] || '').length * 15, 1200) - llmElapsed)
      : 0;
    if (initialDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, initialDelay));
    }

    // Turn off typing indicator right before sending message
    await chatwootService.toggleTypingStatus(accountId, conversationId, 'off');

    // Send primary message (by default exactly 1 single message bubble per turn to minimize Meta charges)
    await chatwootService.sendMessage(accountId, conversationId, chunks[0]);
    await conversacionesRepo.logMessage(conversationId, chunks[0], 'assistant');

    // If chunking is explicitly enabled and there is a second chunk
    if (isChunkingEnabled && chunks.length > 1 && chunks[1]) {
      await chatwootService.toggleTypingStatus(accountId, conversationId, 'on');

      const interChunkDelay = process.env.NODE_ENV !== 'test'
        ? Math.min(Math.max((chunks[1] || '').length * 18, 1200), 2400)
        : 0;
      if (interChunkDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, interChunkDelay));
      }

      await chatwootService.toggleTypingStatus(accountId, conversationId, 'off');
      await chatwootService.sendMessage(accountId, conversationId, chunks[1]);
      await conversacionesRepo.logMessage(conversationId, chunks[1], 'assistant');
    }

    // Schedule inactivity auto-resolve for this conversation
    await autoResolveService.scheduleAutoResolve(accountId, conversationId);

    // Save consolidated response in Redis history with 24h TTL
    history.push({ role: 'assistant', content: safeReply });
    if (history.length > CONTEXT_WINDOW_LIMIT) {
      history = history.slice(-CONTEXT_WINDOW_LIMIT);
      if (history.length > 0 && history[0].role === 'assistant') {
        history = history.slice(1);
      }
    }
    await redis.set(sessionKey, JSON.stringify(history), 'EX', 86400);

    // Release debounce lock and drain any pending messages buffered during processing
    await releaseLockAndDrainBuffer(lockKey, bufferKey, conversationId, payload, module.exports.processWebhookEvent);

    return { status: 'processed', reply: safeReply, chunks };
  },
};
