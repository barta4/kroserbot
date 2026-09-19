const chatwootService = require('../services/chatwoot/chatwootService');
const autoResolveService = require('../services/chatwoot/autoResolveService');
const webhookService = require('../services/webhook/webhookService');
const configuracionRepo = require('../repositories/configuracionRepository');
const redis = require('../config/redis');

// Mock axios for chatwootService HTTP tests
jest.mock('axios');
const axios = require('axios');

describe('Chatwoot Conversation Resolution & Auto-Resolve System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. chatwootService - resolveConversation & addLabels', () => {
    test('resolveConversation returns mock success when no client is configured', async () => {
      // In default test environment without credentials, getChatwootClient returns null
      const res = await chatwootService.resolveConversation(1, 999, 'resolved');
      expect(res.success).toBe(true);
      expect(res.mock).toBe(true);
      expect(res.status).toBe('resolved');
    });

    test('addLabels returns mock success when no client is configured', async () => {
      const res = await chatwootService.addLabels(1, 999, ['resuelto-bot']);
      expect(res.success).toBe(true);
      expect(res.mock).toBe(true);
      expect(res.labels).toEqual(['resuelto-bot']);
    });

    test('addLabels returns immediately if labels array is empty', async () => {
      const res = await chatwootService.addLabels(1, 999, []);
      expect(res.success).toBe(true);
      expect(res.ignored).toBe(true);
    });

    test('resolveConversation calls toggle_status endpoint when axios client is active', async () => {
      const mockPost = jest.fn().mockResolvedValue({ data: { current_status: 'resolved', id: 999 } });
      axios.create.mockReturnValue({ post: mockPost });
      jest.spyOn(configuracionRepo, 'get').mockImplementation(async (key) => {
        if (key === 'chatwoot_base_url') return 'https://app.uruchat.com';
        if (key === 'chatwoot_api_token') return 'mock_token_123';
        return null;
      });

      const res = await chatwootService.resolveConversation(1, 999, 'resolved');
      expect(mockPost).toHaveBeenCalledWith(
        '/api/v1/accounts/1/conversations/999/toggle_status',
        { status: 'resolved' }
      );
      expect(res.success).toBe(true);
      expect(res.data.current_status).toBe('resolved');
    });

    test('resolveConversation handles API errors gracefully without throwing', async () => {
      const mockPost = jest.fn().mockRejectedValue(new Error('Chatwoot connection timeout'));
      axios.create.mockReturnValue({ post: mockPost });
      jest.spyOn(configuracionRepo, 'get').mockImplementation(async (key) => {
        if (key === 'chatwoot_base_url') return 'https://app.uruchat.com';
        if (key === 'chatwoot_api_token') return 'mock_token_123';
        return null;
      });

      const res = await chatwootService.resolveConversation(1, 999, 'resolved');
      expect(res.success).toBe(false);
      expect(res.error).toContain('Chatwoot connection timeout');
    });
  });

  describe('2. autoResolveService', () => {
    afterEach(() => {
      autoResolveService.cancelScheduledResolve(12345);
    });

    test('scheduleAutoResolve stores registration in Redis and sets timer', async () => {
      jest.spyOn(configuracionRepo, 'get').mockResolvedValue('15');
      const spyRedisSet = jest.spyOn(redis, 'set').mockResolvedValue('OK');

      await autoResolveService.scheduleAutoResolve(1, 12345);

      expect(spyRedisSet).toHaveBeenCalledWith(
        'autoresolve_conv:12345',
        expect.stringContaining('"conversationId":12345'),
        'EX',
        expect.any(Number)
      );
    });

    test('cancelScheduledResolve removes Redis key and clears timer', async () => {
      const spyRedisDel = jest.spyOn(redis, 'del').mockResolvedValue(1);
      const cancelled = autoResolveService.cancelScheduledResolve(12345);

      expect(cancelled).toBe(true);
      expect(spyRedisDel).toHaveBeenCalledWith('autoresolve_conv:12345');
    });

    test('executeAutoResolve aborts resolution if human_active flag is set', async () => {
      jest.spyOn(redis, 'get').mockResolvedValue('1'); // human_active is true
      const spyResolve = jest.spyOn(chatwootService, 'resolveConversation');

      const result = await autoResolveService.executeAutoResolve(1, 12345);

      expect(result.success).toBe(false);
      expect(result.reason).toBe('human_active');
      expect(spyResolve).not.toHaveBeenCalled();
    });

    test('executeAutoResolve applies label and calls chatwootService.resolveConversation', async () => {
      jest.spyOn(redis, 'get').mockResolvedValue(null); // No human active
      jest.spyOn(configuracionRepo, 'get').mockImplementation(async (k) => {
        if (k === 'auto_resolve_label') return 'resuelto-bot';
        return null;
      });
      const spyAddLabels = jest.spyOn(chatwootService, 'addLabels').mockResolvedValue({ success: true });
      const spyResolve = jest.spyOn(chatwootService, 'resolveConversation').mockResolvedValue({ success: true });

      const result = await autoResolveService.executeAutoResolve(1, 12345);

      expect(result.success).toBe(true);
      expect(spyAddLabels).toHaveBeenCalledWith(1, 12345, ['resuelto-bot']);
      expect(spyResolve).toHaveBeenCalledWith(1, 12345, 'resolved');
    });

    test('resolveImmediately resolves immediately with configured label', async () => {
      jest.spyOn(redis, 'get').mockResolvedValue(null);
      const spyAddLabels = jest.spyOn(chatwootService, 'addLabels').mockResolvedValue({ success: true });
      const spyResolve = jest.spyOn(chatwootService, 'resolveConversation').mockResolvedValue({ success: true });

      const result = await autoResolveService.resolveImmediately(1, 12345, 'farewell');

      expect(result.success).toBe(true);
      expect(spyAddLabels).toHaveBeenCalled();
      expect(spyResolve).toHaveBeenCalledWith(1, 12345, 'resolved');
    });
  });

  describe('3. webhookService - Farewell & Escalation integration', () => {
    test('Pure farewell automatically triggers immediate resolution', async () => {
      jest.spyOn(redis, 'set').mockResolvedValue('OK');
      jest.spyOn(redis, 'get').mockImplementation(async (k) => {
        if (k.startsWith('human_active:')) return null;
        if (k.startsWith('conv_memory:')) return JSON.stringify([{ role: 'user', content: 'hola' }]);
        return null;
      });
      const spyImmediate = jest.spyOn(autoResolveService, 'resolveImmediately').mockResolvedValue({ success: true });

      const payload = {
        event: 'message_created',
        conversation: { id: 777, account_id: 1 },
        message: {
          id: 501,
          content: 'Muchas gracias por todo chau',
          message_type: 'incoming',
          sender: { type: 'user', name: 'Carlos' },
        },
      };

      const result = await webhookService.processWebhookEvent(payload);

      expect(result.status).toBe('processed');
      expect(result.action).toBe('pure_farewell');
      expect(result.autoResolved).toBe(true);
      expect(spyImmediate).toHaveBeenCalledWith(1, 777, 'farewell');
    });

    test('Human escalation (DERIVAR:...) cancels auto-resolve and does NOT close conversation', async () => {
      jest.spyOn(redis, 'set').mockResolvedValue('OK');
      jest.spyOn(redis, 'get').mockResolvedValue(null);
      const spyCancel = jest.spyOn(autoResolveService, 'cancelScheduledResolve');
      const spyResolve = jest.spyOn(chatwootService, 'resolveConversation');

      const payload = {
        event: 'message_created',
        conversation: { id: 888, account_id: 1 },
        message: {
          id: 502,
          content: 'Quiero hablar con una persona de ventas por favor',
          message_type: 'incoming',
          sender: { type: 'user', name: 'Laura' },
        },
      };

      // Mock LLM returning derivation pattern
      const llmService = require('../services/llm/llmService');
      jest.spyOn(llmService, 'generateWithTools').mockResolvedValue({
        reply: 'DERIVAR: ecommerce',
        toolsUsed: [],
      });

      const result = await webhookService.processWebhookEvent(payload);

      expect(result.status).toBe('processed');
      expect(result.action).toBe('human_escalation');
      expect(spyCancel).toHaveBeenCalledWith(888);
      expect(spyResolve).not.toHaveBeenCalled();
    });
  });
});
