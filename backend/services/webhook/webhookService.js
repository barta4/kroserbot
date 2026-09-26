const redis = require('../../config/redis');
const configuracionRepo = require('../../repositories/configuracionRepository');
const conversacionesRepo = require('../../repositories/conversacionesRepository');
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
const botLoopDetector = require('../guardrails/botLoopDetector');
const orderTrackingService = require('../pedidos/orderTrackingService');
const debounceService = require('./debounceService');
const logger = require('../../config/logger');
const orderExtractor = require('../pedidos/orderExtractor');
const derivationNoteService = require('../chatwoot/derivationNoteService');
const autoResolveService = require('../chatwoot/autoResolveService');
const businessHours = require('../../utils/businessHours');

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
          await botLoopDetector.resetTurns(conversationId);
          autoResolveService.cancelScheduledResolve(conversationId);
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
    const messageType = (message.message_type || payload.message_type || '').toLowerCase();
    const isHumanAgent = senderType === 'agent' || (senderType === 'user' && messageType === 'outgoing');

    // 2. Idempotency Check: Atomic dedup by message_id with SET NX
    if (messageId) {
      const dedupKey = `msg_processed:${messageId}`;
      const isNew = await redis.set(dedupKey, '1', 'EX', IDEMPOTENCY_TTL, 'NX');
      if (!isNew) {
        logger.info('Duplicate message ignored', { correlationId, messageId });
        return { status: 'ignored', reason: 'duplicate_message' };
      }
    }

    // 3. Human Agent Takeover: If a human agent sends a message, immediately silence the bot
    if (isHumanAgent) {
      logger.info('Human agent message detected. Silencing bot.', { correlationId, conversationId });
      if (conversationId) {
        await redis.set(`human_active:${conversationId}`, '1', 'EX', HUMAN_ACTIVE_TTL);
        debounceService.cancel(conversationId);
        await redis.del(`conv_buffer:${conversationId}`);
        await botLoopDetector.resetTurns(conversationId);
        autoResolveService.cancelScheduledResolve(conversationId);
      }
      return { status: 'ignored', reason: 'agent_message' };
    }

    // Filter Outgoing or Bot messages (avoid infinite loops)
    if (message.message_type === 'outgoing' || senderType === 'bot') {
      logger.info('Outgoing/bot message ignored', { correlationId });
      return { status: 'ignored', reason: 'bot_or_outgoing_message' };
    }

    // Active customer message: cancel any pending auto-resolve for this conversation
    if (conversationId) {
      autoResolveService.cancelScheduledResolve(conversationId);
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
        const assigneeId = (await configuracionRepo.get(`assignee_id_${area}`)) || 1;
        const msgDerivacion =
          (await configuracionRepo.get('msg_derivacion')) ||
          'Le estamos derivando con un asesor especializado que podrá brindarle una atención personalizada. Por favor aguarde un instante.';

        // Check human business hours
        const channel = (
          conversation.channel ||
          conversation.inbox?.channel_type ||
          payload.inbox?.channel_type ||
          payload.channel ||
          payload.channel_type ||
          'whatsapp'
        ).toLowerCase();

        const bConfig = await configuracionRepo.getMultiple([
          'business_hours_weekday_start',
          'business_hours_weekday_end',
          'business_hours_saturday_enabled',
          'business_hours_saturday_start',
          'business_hours_saturday_end',
          'contact_alternative_email',
          'msg_fuera_de_horario',
        ]);

        const hoursStatus = businessHours.isWithinBusinessHours(new Date(), bConfig);
        const nextBusinessDay = businessHours.getNextBusinessDayString(new Date(), bConfig);
        const isOutOfHours = !hoursStatus.isWithin;

        let msgToSend = msgDerivacion;
        if (isOutOfHours) {
          msgToSend = businessHours.getOutHoursMessage({
            channel,
            nextBusinessDay,
            alternativeEmail: bConfig.contact_alternative_email || 'atencion@kroser.com.uy',
            customTemplate: bConfig.msg_fuera_de_horario,
          });
        }

        if (conversationId && !isOutOfHours) {
          await redis.set(`human_active:${conversationId}`, '1', 'EX', HUMAN_ACTIVE_TTL);
          debounceService.cancel(conversationId);
          await redis.del(`conv_buffer:${conversationId}`);
        } else if (conversationId && isOutOfHours) {
          debounceService.cancel(conversationId);
          await redis.del(`conv_buffer:${conversationId}`);
        }

        await chatwootService.assignAgent(accountId, conversationId, assigneeId);
        await chatwootService.sendMessage(accountId, conversationId, msgToSend);

        if (isOutOfHours) {
          const labels = ['fuera-de-horario'];
          if (hoursStatus.reason === 'weekend') labels.push('fin-de-semana');
          await chatwootService.addLabels(accountId, conversationId, labels);
        }

        // Generate executive summary & action plan as private note for agent
        await derivationNoteService.generateAndSendDerivationNote({
          accountId,
          conversationId,
          area,
          sender,
          reason: isOutOfHours
            ? `[Fuera de Horario - ${hoursStatus.reason.toUpperCase()}] ${guardrail.reason || 'Guardrail activado'}. Atención humana retoma ${nextBusinessDay}.`
            : (guardrail.reason || 'Guardrail de seguridad activado por conducta reiterada'),
          history: [{ role: 'user', content: fullContent }],
          ragContextStr: '',
        });

        await emailService.sendDerivationAlert({
          area,
          clienteNombre: sender.name,
          clienteTelefono: sender.phone_number,
          clienteMail: sender.email,
          conversationId,
          motivo: isOutOfHours
            ? `[FUERA DE HORARIO - ${hoursStatus.reason.toUpperCase()}] ${guardrail.reason || 'Guardrail activado'}`
            : (guardrail.reason || 'Guardrail de seguridad activado por conducta reiterada'),
        });

        return { status: 'processed', action: 'guardrail_escalation', category: guardrail.category, isOutOfHours };
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
      return { status: 'ignored', reason: 'farewell_loop_prevented' };
    }

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

      // Auto-resolve immediately on farewell if enabled
      const autoResolveFarewell = (await configuracionRepo.get('auto_resolve_on_farewell')) !== 'false';
      if (autoResolveFarewell) {
        await autoResolveService.resolveImmediately(accountId, conversationId, 'farewell');
      }

      logger.info('Pure farewell handled directly with formal closing', { correlationId, autoResolved: autoResolveFarewell });
      return { status: 'processed', action: 'pure_farewell', reply: farewellReply, autoResolved: autoResolveFarewell };
    }

    // Add current user message to conversation history
    history.push({ role: 'user', content: fullContent });

    // 14. Expand Context Window & Handle Summarization if Long
    let processedHistory = history;
    let conversationSummaryStr = '';
    if (history.length > CONTEXT_WINDOW_LIMIT) {
      const olderMessages = history.slice(0, history.length - 8);
      let recentMessages = history.slice(-8);

      // Ensure recent window starts with a user message for natural dialog flow
      if (recentMessages.length > 0 && recentMessages[0].role === 'assistant') {
        recentMessages = recentMessages.slice(1);
      }

      // Compact summary of older turns for the System Prompt
      conversationSummaryStr = olderMessages
        .map((m) => `${m.role === 'user' ? 'Cliente' : 'Asesor'}: ${m.content}`)
        .join(' | ')
        .slice(-600);

      // Keep processedHistory strictly containing user/assistant dialog messages
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

      return { status: 'processed', action: 'turn_limit_reached', turnCount: turnCheck.turnCount };
    }

    // 16. Build Dynamic, Humanized, Lightweight System Prompt (No unconditional RAG)
    const fullSystemPrompt = await promptBuilder.buildSystemPrompt({
      customerProfileStr: customerMemory.contextStr,
      trackingContextStr,
      conversationSummaryStr,
      detectedEmotion: intentResult.emotion,
      messageCount: history.length,
      customerName: sender.name,
    });

    // 17. Call LLM with Agentic Tools & Typing Indicator Active
    await chatwootService.toggleTypingStatus(accountId, conversationId, 'on');
    const startLlmTime = Date.now();

    const toolContext = {
      conversationId,
      accountId,
      channel: conversation.channel || 'chatwoot',
      sender,
    };

    const { reply: llmReply, toolsUsed, createdOrder: toolCreatedOrder } = await llmService.generateWithTools(
      fullSystemPrompt,
      processedHistory,
      { toolContext }
    );
    const llmElapsed = Date.now() - startLlmTime;

    logger.info('LLM reply generated with tools', {
      correlationId,
      replyLength: llmReply.length,
      llmElapsedMs: llmElapsed,
      toolsCount: toolsUsed.length,
    });

    // 18. Check Human Escalation (DERIVAR... pattern)
    if (llmReply.toUpperCase().startsWith('DERIVAR:')) {
      const match = llmReply.match(/DERIVAR:\s*(\w+)/i);
      const area = match ? match[1].toLowerCase() : 'info';

      const assigneeId = (await configuracionRepo.get(`assignee_id_${area}`)) || 1;
      const defaultMsgDerivacion =
        (await configuracionRepo.get('msg_derivacion')) ||
        'Le estamos derivando con un asesor especializado que podrá brindarle una atención personalizada. Por favor aguarde un instante.';

      // Check human business hours
      const channel = (
        conversation.channel ||
        conversation.inbox?.channel_type ||
        payload.inbox?.channel_type ||
        payload.channel ||
        payload.channel_type ||
        'whatsapp'
      ).toLowerCase();

      const bConfig = await configuracionRepo.getMultiple([
        'business_hours_weekday_start',
        'business_hours_weekday_end',
        'business_hours_saturday_enabled',
        'business_hours_saturday_start',
        'business_hours_saturday_end',
        'contact_alternative_email',
        'msg_fuera_de_horario',
      ]);

      const hoursStatus = businessHours.isWithinBusinessHours(new Date(), bConfig);
      const nextBusinessDay = businessHours.getNextBusinessDayString(new Date(), bConfig);
      const isOutOfHours = !hoursStatus.isWithin;

      let msgToSend = defaultMsgDerivacion;
      if (isOutOfHours) {
        msgToSend = businessHours.getOutHoursMessage({
          channel,
          nextBusinessDay,
          alternativeEmail: bConfig.contact_alternative_email || 'atencion@kroser.com.uy',
          customTemplate: bConfig.msg_fuera_de_horario,
        });
      }

      // Silence the bot ONLY if within business hours (human is ready to respond immediately).
      // If out-of-hours / weekend, do NOT silence the bot permanently so customer can keep asking about products/catalog!
      if (conversationId && !isOutOfHours) {
        await redis.set(`human_active:${conversationId}`, '1', 'EX', HUMAN_ACTIVE_TTL);
        debounceService.cancel(conversationId);
        await redis.del(`conv_buffer:${conversationId}`);
        autoResolveService.cancelScheduledResolve(conversationId);
      } else if (conversationId && isOutOfHours) {
        // Cancel pending debounce & scheduled resolve, but keep bot awake for catalog queries
        debounceService.cancel(conversationId);
        await redis.del(`conv_buffer:${conversationId}`);
        autoResolveService.cancelScheduledResolve(conversationId);
      }

      await chatwootService.toggleTypingStatus(accountId, conversationId, 'off');

      // Assign in Chatwoot & send appropriate message
      await chatwootService.assignAgent(accountId, conversationId, assigneeId);
      await chatwootService.sendMessage(accountId, conversationId, msgToSend);
      await conversacionesRepo.logMessage(conversationId, msgToSend, 'assistant');

      // Persist escalation or out-of-hours response in Redis memory
      history.push({ role: 'assistant', content: msgToSend });
      if (history.length > CONTEXT_WINDOW_LIMIT) {
        history = history.slice(-CONTEXT_WINDOW_LIMIT);
        if (history.length > 0 && history[0].role === 'assistant') {
          history = history.slice(1);
        }
      }
      await redis.set(sessionKey, JSON.stringify(history), 'EX', 86400);

      // Add out-of-hours tags in Chatwoot if applicable
      if (isOutOfHours) {
        const labels = ['fuera-de-horario'];
        if (hoursStatus.reason === 'weekend') labels.push('fin-de-semana');
        await chatwootService.addLabels(accountId, conversationId, labels);
      }

      // Generate executive summary & action plan as private note for agent
      await derivationNoteService.generateAndSendDerivationNote({
        accountId,
        conversationId,
        area,
        sender,
        reason: isOutOfHours
          ? `Derivación fuera de horario (${hoursStatus.reason.toUpperCase()}). Atención humana retoma ${nextBusinessDay}. Consulta original: "${content}"`
          : content,
        history,
        ragContextStr: toolsUsed.length > 0 ? JSON.stringify(toolsUsed) : '',
      });

      // Send email alert to internal area
      await emailService.sendDerivationAlert({
        area,
        clienteNombre: sender.name,
        clienteTelefono: sender.phone_number,
        clienteMail: sender.email,
        conversationId,
        motivo: isOutOfHours
          ? `[FUERA DE HORARIO - ${hoursStatus.reason.toUpperCase()}] ${content}`
          : content,
      });

      return {
        status: 'processed',
        action: 'human_escalation',
        area,
        isOutOfHours,
        reason: hoursStatus.reason,
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

    // 21. Human Typing Delay: calculate natural pacing based on response length
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

    // Schedule inactivity auto-resolve for this conversation
    await autoResolveService.scheduleAutoResolve(accountId, conversationId);

    // Save updated history in Redis with 24h TTL
    history.push({ role: 'assistant', content: safeReply });
    if (history.length > CONTEXT_WINDOW_LIMIT) {
      history = history.slice(-CONTEXT_WINDOW_LIMIT);
      if (history.length > 0 && history[0].role === 'assistant') {
        history = history.slice(1);
      }
    }
    await redis.set(sessionKey, JSON.stringify(history), 'EX', 86400);

    // Release debounce lock and drain any pending messages buffered during processing
    const recursionDepth = payload._recursionDepth || 0;
    if (lockKey && !payload._alreadyDebounced) {
      await redis.del(lockKey);
      const remainingBuffered = await redis.lrange(bufferKey, 0, -1);
      if (remainingBuffered && remainingBuffered.length > 0) {
        await redis.del(bufferKey);
        const nextContent = remainingBuffered.join('\n');
        if (recursionDepth < 2) {
          setImmediate(async () => {
            try {
              await module.exports.processWebhookEvent({
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
    }

    return { status: 'processed', reply: safeReply };
  },
};
