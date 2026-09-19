const redis = require('../../config/redis');
const configuracionRepo = require('../../repositories/configuracionRepository');
const chatwootService = require('./chatwootService');
const logger = require('../../config/logger');

const scheduledTimers = new Map();

module.exports = {
  /**
   * Schedules an auto-resolve for a conversation after a configured inactivity period
   */
  async scheduleAutoResolve(accountId, conversationId) {
    if (!conversationId) return;

    try {
      const timeoutMinutesRaw = await configuracionRepo.get('auto_resolve_timeout_minutes');
      const timeoutMinutes = parseInt(timeoutMinutesRaw || '15', 10);

      // 0 or negative means auto-resolve by inactivity is disabled
      if (isNaN(timeoutMinutes) || timeoutMinutes <= 0) {
        this.cancelScheduledResolve(conversationId);
        return;
      }

      // Cancel any existing timer for this conversation
      this.cancelScheduledResolve(conversationId);

      const waitMs = timeoutMinutes * 60 * 1000;
      const scheduledAt = Date.now();
      const expiresAt = scheduledAt + waitMs;

      // Persist in Redis with TTL (timeout + 1 hour buffer)
      const redisKey = `autoresolve_conv:${conversationId}`;
      await redis.set(
        redisKey,
        JSON.stringify({ accountId, conversationId, scheduledAt, expiresAt }),
        'EX',
        Math.ceil(waitMs / 1000) + 3600
      );

      // In-memory timer for instant local execution
      const timer = setTimeout(async () => {
        scheduledTimers.delete(conversationId);
        await this.executeAutoResolve(accountId, conversationId);
      }, waitMs);

      // Unref timer in Node so it doesn't block process exit in tests/shutdown
      if (timer.unref) timer.unref();

      scheduledTimers.set(conversationId, timer);
      logger.info('Auto-resolve scheduled for conversation', { conversationId, timeoutMinutes });
    } catch (err) {
      logger.error('Error scheduling auto-resolve', { conversationId, error: err.message });
    }
  },

  /**
   * Cancels any pending auto-resolve for the conversation
   */
  cancelScheduledResolve(conversationId) {
    if (!conversationId) return false;

    if (scheduledTimers.has(conversationId)) {
      const timer = scheduledTimers.get(conversationId);
      clearTimeout(timer);
      scheduledTimers.delete(conversationId);
    }

    // Also remove from Redis asynchronously
    redis.del(`autoresolve_conv:${conversationId}`).catch((err) => {
      logger.warn('Error deleting autoresolve Redis key', { conversationId, error: err.message });
    });

    return true;
  },

  /**
   * Safely executes conversation resolution checking preconditions
   */
  async executeAutoResolve(accountId, conversationId) {
    if (!conversationId) return { success: false, reason: 'missing_conversation_id' };

    try {
      // 1. Safety Guard: Human agent active
      const isHumanActive = await redis.get(`human_active:${conversationId}`);
      if (isHumanActive) {
        logger.info('Auto-resolve aborted: human agent active in conversation', { conversationId });
        this.cancelScheduledResolve(conversationId);
        return { success: false, reason: 'human_active' };
      }

      // 2. Fetch label if configured
      const label = (await configuracionRepo.get('auto_resolve_label')) || 'resuelto-bot';
      if (label && label.trim()) {
        await chatwootService.addLabels(accountId, conversationId, [label.trim()]);
      }

      // 3. Resolve conversation in Chatwoot
      const result = await chatwootService.resolveConversation(accountId, conversationId, 'resolved');

      // 4. Cleanup Redis
      await redis.del(`autoresolve_conv:${conversationId}`);

      logger.info('Conversation auto-resolved due to inactivity', {
        conversationId,
        accountId,
        label,
        success: result.success,
      });

      return { success: true, result };
    } catch (err) {
      logger.error('Error executing auto-resolve', { conversationId, error: err.message });
      return { success: false, error: err.message };
    }
  },

  /**
   * Immediately resolves conversation (e.g. on client farewell or confirmed order)
   */
  async resolveImmediately(accountId, conversationId, reason = 'farewell') {
    if (!conversationId) return { success: false, reason: 'missing_conversation_id' };

    try {
      this.cancelScheduledResolve(conversationId);

      // Check human active flag
      const isHumanActive = await redis.get(`human_active:${conversationId}`);
      if (isHumanActive) {
        logger.info('Immediate resolve skipped: human agent active in conversation', { conversationId, reason });
        return { success: false, reason: 'human_active' };
      }

      const label = (await configuracionRepo.get('auto_resolve_label')) || 'resuelto-bot';
      if (label && label.trim()) {
        await chatwootService.addLabels(accountId, conversationId, [label.trim()]);
      }

      const result = await chatwootService.resolveConversation(accountId, conversationId, 'resolved');

      logger.info('Conversation resolved immediately', {
        conversationId,
        accountId,
        reason,
        label,
        success: result.success,
      });

      return { success: true, result };
    } catch (err) {
      logger.error('Error in immediate resolve', { conversationId, reason, error: err.message });
      return { success: false, error: err.message };
    }
  },
};
