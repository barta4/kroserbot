const redis = require('../../config/redis');
const logger = require('../../config/logger');
const chatwootService = require('../chatwoot/chatwootService');
const configuracionRepo = require('../../repositories/configuracionRepository');
const debounceService = require('./debounceService');
const autoResolveService = require('../chatwoot/autoResolveService');
const botLoopDetector = require('../guardrails/botLoopDetector');

const HUMAN_ACTIVE_TTL = 86400; // 24 hours

/**
 * Checks whether the incoming event or channel is disabled in configuracion
 */
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
      const match =
        channelType === disabled ||
        (disabled.length >= 3 && channelType.includes(disabled)) ||
        (channelType.length >= 3 && disabled.includes(channelType));
      if (match) {
        return { disabled: true, match: disabled, channelType };
      }
    }

    // Check by inbox ID (e.g. '3', 'inbox:3')
    if (inboxId && (disabled === inboxId || disabled === `inbox:${inboxId}`)) {
      return { disabled: true, match: disabled, inboxId };
    }

    // Check by inbox name (e.g. 'instagram oficial')
    if (inboxName) {
      const match =
        inboxName === disabled ||
        (disabled.length >= 3 && inboxName.includes(disabled)) ||
        (inboxName.length >= 3 && disabled.includes(inboxName));
      if (match) {
        return { disabled: true, match: disabled, inboxName };
      }
    }
  }

  return false;
}

/**
 * Handles conversation assignment and status changes (conversation_updated / conversation_status_changed)
 */
async function handleConversationEvent(payload, { correlationId, botAgentId }) {
  const conversation = payload.conversation || {};
  const conversationId = conversation.id || payload.conversation_id;
  const assigneeId = conversation.assignee_id || conversation.meta?.assignee?.id || conversation.assignee?.id;
  const status = conversation.status || payload.status;

  if (conversationId) {
    if (status === 'resolved') {
      await redis.del(`human_active:${conversationId}`);
      debounceService.cancel(conversationId);
      await redis.del(`conv_buffer:${conversationId}`);
      await botLoopDetector.resetTurns(conversationId);
      logger.info('Conversation resolved in Uruchat. Human active flag cleared.', { correlationId, conversationId });
      return { status: 'processed', action: 'conversation_resolved_cleared', conversationId };
    }

    if (assigneeId && botAgentId && String(assigneeId) !== String(botAgentId)) {
      await redis.set(`human_active:${conversationId}`, '1', 'EX', HUMAN_ACTIVE_TTL);
      debounceService.cancel(conversationId);
      await redis.del(`conv_buffer:${conversationId}`);
      await botLoopDetector.resetTurns(conversationId);
      autoResolveService.cancelScheduledResolve(conversationId);
      logger.info('Conversation assigned to human agent. Bot silenced.', { correlationId, conversationId, assigneeId });
      return { status: 'processed', action: 'human_assigned', conversationId, assigneeId };
    } else if (!assigneeId || (botAgentId && String(assigneeId) === String(botAgentId))) {
      await redis.del(`human_active:${conversationId}`);
      logger.info('Conversation unassigned or assigned to bot. Bot reactivated.', { correlationId, conversationId });
      return { status: 'processed', action: 'bot_reactivated', conversationId };
    }
  }
  return { status: 'ignored', reason: 'conversation_event_unhandled' };
}

/**
 * Handles outgoing messages to differentiate bot self-messages from human agent takeover
 */
async function handleOutgoingMessage(payload, { correlationId, conversationId, botAgentId, message, messageId, sender, senderType, content }) {
  // Detect if this outgoing message was sent by the bot (avoid bot self-takeover loops)
  const isBotSent = messageId ? await redis.get(`bot_sent_msg:${messageId}`) : null;
  const isBotSending = conversationId ? await redis.get(`bot_sending:${conversationId}`) : null;
  const lastBotReply = conversationId ? await redis.get(`last_bot_reply:${conversationId}`) : null;
  const isContentMatch = Boolean(
    lastBotReply &&
    content &&
    (content === lastBotReply ||
      (content.length >= 25 && (lastBotReply.includes(content) || content.includes(lastBotReply))))
  );

  const isBotSender = Boolean(
    isBotSent ||
    isBotSending ||
    isContentMatch ||
    senderType === 'bot' ||
    sender.type === 'agent_bot' ||
    (botAgentId && sender.id && String(sender.id) === String(botAgentId))
  );

  if (isBotSender) {
    logger.info('Bot self-message ignored', { correlationId, messageId });
    // If human_active was mistakenly set in this conversation, clear it!
    if (conversationId) {
      await redis.del(`human_active:${conversationId}`);
    }
    return { status: 'ignored', reason: 'bot_self_message' };
  }

  // If outgoing and NOT sent by the bot, a human agent is intervening in Chatwoot/Uruchat
  const isHumanAgent = senderType === 'agent' || senderType === 'user' || !senderType;
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

  // Other outgoing or bot messages
  logger.info('Outgoing/bot message ignored', { correlationId });
  return { status: 'ignored', reason: 'bot_or_outgoing_message' };
}

/**
 * Checks if conversation is assigned to human or has human active flag in Redis
 */
async function checkHumanActive({ conversation, conversationId, botAgentId, correlationId }) {
  const assigneeId = conversation.assignee_id || conversation.meta?.assignee?.id || conversation.assignee?.id;
  if (assigneeId && botAgentId && String(assigneeId) !== String(botAgentId)) {
    logger.info('Conversation currently assigned to human agent. Bot silenced.', { correlationId, conversationId, assigneeId });
    if (conversationId) {
      await redis.set(`human_active:${conversationId}`, '1', 'EX', HUMAN_ACTIVE_TTL);
      debounceService.cancel(conversationId);
      await redis.del(`conv_buffer:${conversationId}`);
    }
    return { isHuman: true, reason: 'assigned_to_human' };
  }

  if (conversationId) {
    const isHumanActive = await redis.get(`human_active:${conversationId}`);
    if (isHumanActive) {
      logger.info('Human agent active in conversation. Bot silenced.', { correlationId, conversationId });
      return { isHuman: true, reason: 'human_active' };
    }
  }

  return { isHuman: false };
}

/**
 * Handles server bounce (delivery failures) and no-reply automated mailboxes
 */
async function handleServerBounceAndNoReply({ payload, conversationId, accountId, correlationId }) {
  const emailData = botLoopDetector.extractEmailData(payload);

  // 1) Si es No-Reply: NO CONTESTAR (descartar en silencio para evitar respuestas a casillas automáticas)
  const noReplyCheck = botLoopDetector.isNoReply(emailData);
  if (noReplyCheck) {
    logger.info('No-Reply email detected. Bot will not respond (ignoring).', {
      correlationId,
      conversationId,
      reason: noReplyCheck.reason,
      email: emailData.email,
    });
    if (conversationId) {
      debounceService.cancel(conversationId);
    }
    return {
      handled: true,
      result: {
        status: 'ignored',
        reason: 'noreply_email',
        senderEmail: emailData.email,
        matchedReason: noReplyCheck.reason,
      },
    };
  }

  // 2) Si rebota del servidor (Mailer-Daemon / Delivery Failure): APLICAR EL SHIELD
  const bounceCheck = botLoopDetector.isServerBounce(emailData);
  if (bounceCheck) {
    logger.warn('Server bounce detected. Applying Bot Loop Shield to prevent bounce loops.', {
      correlationId,
      conversationId,
      reason: bounceCheck.reason,
      email: emailData.email,
    });
    if (conversationId) {
      await redis.set(`human_active:${conversationId}`, '1', 'EX', HUMAN_ACTIVE_TTL);
      debounceService.cancel(conversationId);
      await redis.del(`conv_buffer:${conversationId}`);
      await botLoopDetector.resetTurns(conversationId);
      autoResolveService.cancelScheduledResolve(conversationId);
    }
    if (conversationId && accountId) {
      const bounceDetail = emailData.email || bounceCheck.email || bounceCheck.matchedBody || bounceCheck.reason || 'Mailer-Daemon';
      await chatwootService.addPrivateNote(
        accountId,
        conversationId,
        `🛑 [Auto-Shield] Rebote de servidor detectado (${bounceDetail}). El bot ha sido silenciado para evitar un bucle de rebotes.`
      );
      await chatwootService.addLabels(accountId, conversationId, ['rebote-email', 'auto-shield']);
    }
    return {
      handled: true,
      result: {
        status: 'ignored',
        reason: 'server_bounce_shield_applied',
        shieldApplied: true,
        conversationId,
        matchedReason: bounceCheck.reason,
        senderEmail: emailData.email,
      },
    };
  }

  return { handled: false };
}

module.exports = {
  isChannelDisabled,
  handleConversationEvent,
  handleOutgoingMessage,
  checkHumanActive,
  handleServerBounceAndNoReply,
};
