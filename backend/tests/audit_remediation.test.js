const request = require('supertest');
const express = require('express');
const webhookController = require('../controllers/webhookController');
const webhookService = require('../services/webhook/webhookService');
const debounceService = require('../services/webhook/debounceService');
const promptBuilder = require('../services/webhook/promptBuilder');
const orderExtractor = require('../services/pedidos/orderExtractor');
const pedidosRepo = require('../repositories/pedidosRepository');
const llmService = require('../services/llm/llmService');
const redis = require('../config/redis');
const configuracionRepo = require('../repositories/configuracionRepository');
const db = require('../config/db');
const logger = require('../config/logger');
const apiLimiter = require('../middleware/rateLimiter');

describe('Audit Report Remediations Behavioral Test Suite (H1-H11)', () => {
  afterAll(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('H1: Real-Time Adaptive Debounce Buffer', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('Aggregates multiple rapid messages and triggers callback once with consolidated text', async () => {
      const callback = jest.fn().mockResolvedValue();
      const convId = 91001;

      // Send two consecutive messages
      await debounceService.addMessage(convId, 'Hola, buenas tardes', callback);
      await debounceService.addMessage(convId, '¿Tienen discos de corte para amoladora?', callback);

      // Before timer fires, callback should not be called
      expect(callback).not.toHaveBeenCalled();

      // Fast-forward past debounce window
      jest.advanceTimersByTime(4000);

      // Callback must be called exactly once with aggregated text
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith('Hola, buenas tardes\n¿Tienen discos de corte para amoladora?');
    });

    test('debounceService.cancel successfully cancels pending buffer without firing callback', async () => {
      const callback = jest.fn().mockResolvedValue();
      const convId = 91002;

      await debounceService.addMessage(convId, 'Consulta que será cancelada', callback);
      const cancelled = debounceService.cancel(convId);
      expect(cancelled).toBe(true);

      jest.advanceTimersByTime(4000);
      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('H2: Atomic Idempotency via SET NX', () => {
    const testDedupKey = 'msg_processed:test_audit_remediation_h2';

    afterEach(async () => {
      await redis.del(testDedupKey);
    });

    test('First invocation succeeds with OK and duplicate invocation returns null', async () => {
      // First attempt: key does not exist, should succeed
      const firstSet = await redis.set(testDedupKey, '1', 'EX', 3600, 'NX');
      expect(firstSet).toBe('OK');

      // Second attempt with same key: should be rejected atomically
      const secondSet = await redis.set(testDedupKey, '1', 'EX', 3600, 'NX');
      expect(secondSet).toBeNull();
    });
  });

  describe('H3: Webhook Recursion Depth Guard', () => {
    test('Logs warning and drops processing when recursion depth limit (>= 2) is reached', async () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const convId = 77099;
      const bufferKey = `conv_buffer:${convId}`;

      // Mock LLM generation and inject a buffered message while "LLM is processing"
      const llmSpy = jest.spyOn(llmService, 'generateWithTools').mockImplementationOnce(async () => {
        await redis.rpush(bufferKey, 'Mensaje extra acumulado durante procesamiento');
        return { reply: 'Disponemos de amoladoras Bosch en sucursal Centro.', toolsUsed: [] };
      });

      const result = await webhookService.processWebhookEvent({
        event: 'message_created',
        message: { id: 987654, content: '¿Tienen amoladoras Bosch?' },
        sender: { type: 'contact', name: 'Usuario Prueba' },
        conversation: { id: convId },
        _recursionDepth: 2,
      });

      expect(result.status).toBe('processed');
      expect(warnSpy).toHaveBeenCalledWith(
        'Max webhook recursion depth reached, discarding remaining buffer',
        expect.objectContaining({ conversationId: convId, droppedCount: 1 })
      );

      await redis.del(bufferKey);
      llmSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe('H4 & H8: Webhook Validation Contract & Quick Acknowledgement', () => {
    const app = express();
    app.use(express.json());
    app.post('/webhook', webhookController.handleWebhook);

    test('Rejects payload missing event property with 400 Bad Request', async () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});

      const res = await request(app)
        .post('/webhook')
        .send({ message: { content: 'Mensaje sin evento' } });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Payload de webhook inválido');
      expect(res.body.details).toBeDefined();

      warnSpy.mockRestore();
    });

    test('Acepta payload válido de Chatwoot con 200 OK y despacha al debounce', async () => {
      const addMessageSpy = jest.spyOn(debounceService, 'addMessage').mockImplementation(() => {});

      const res = await request(app)
        .post('/webhook')
        .send({
          event: 'message_created',
          message: {
            id: 999991,
            content: 'Buenas tardes',
            message_type: 'incoming',
          },
          conversation: { id: 88881 },
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('received');
      expect(addMessageSpy).toHaveBeenCalledWith(88881, 'Buenas tardes', expect.any(Function));

      addMessageSpy.mockRestore();
    });
  });

  describe('H5: Database Fallback Resilience and Logging', () => {
    test('ConfiguracionRepository gracefully falls back on get(), set(), and getAll() during DB outage', async () => {
      const warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => {});
      const dbSpy = jest.spyOn(db, 'query').mockRejectedValue(new Error('Connection lost'));

      // 1. get fallback
      const sysPrompt = await configuracionRepo.get('system_prompt');
      expect(typeof sysPrompt).toBe('string');
      expect(sysPrompt.length).toBeGreaterThan(0);
      expect(warnSpy).toHaveBeenCalledWith(
        'ConfiguracionRepository get query failed, returning fallback',
        expect.objectContaining({ key: 'system_prompt', error: 'Connection lost' })
      );

      // 2. set fallback
      const setResult = await configuracionRepo.set('test_key_temp', 'val_temp');
      expect(setResult.value).toBe('val_temp');
      expect(warnSpy).toHaveBeenCalledWith(
        'ConfiguracionRepository set query failed, returning transient value',
        expect.objectContaining({ key: 'test_key_temp', error: 'Connection lost' })
      );

      // 3. getAll fallback
      const all = await configuracionRepo.getAll();
      expect(all).toHaveProperty('system_prompt');
      expect(all.system_prompt).toBe(sysPrompt);
      expect(warnSpy).toHaveBeenCalledWith(
        'ConfiguracionRepository getAll query failed, returning defaults',
        expect.objectContaining({ error: 'Connection lost' })
      );

      dbSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe('H6: Ghost Order Fallback Inactive by Default & Active on Flag', () => {
    afterEach(() => {
      delete process.env.ENABLE_HEURISTIC_ORDER_FALLBACK;
      jest.restoreAllMocks();
    });

    test('OrderExtractor does not create fallback orders with SKU PEDIDO-CHAT by default', async () => {
      delete process.env.ENABLE_HEURISTIC_ORDER_FALLBACK;
      const createSpy = jest.spyOn(pedidosRepo, 'create');
      const history = [
        { role: 'user', content: 'Quiero comprar algo' },
        { role: 'assistant', content: 'Pedido registrado' },
        { role: 'user', content: 'Mi telefono es 099123456 y mi direccion es Av Italia 1234' },
      ];

      const result = await orderExtractor.processOrderFromReply({
        rawReply: '¡Hemos registrado su pedido! Lo llamaremos al 099123456.',
        conversationId: 54321,
        accountId: 1,
        history,
        channel: 'whatsapp',
      });

      expect(result.createdOrder).toBeNull();
      expect(createSpy).not.toHaveBeenCalled();
    });

    test('OrderExtractor triggers fallback order when ENABLE_HEURISTIC_ORDER_FALLBACK is true', async () => {
      process.env.ENABLE_HEURISTIC_ORDER_FALLBACK = 'true';
      const fakeOrder = { id: 777, conversation_id: '54322' };
      const createSpy = jest.spyOn(pedidosRepo, 'create').mockResolvedValue(fakeOrder);

      const history = [
        { role: 'user', content: 'Quiero encargar una pala' },
        { role: 'assistant', content: 'Perfecto' },
        { role: 'user', content: 'Mi telefono es 099123456 y mi direccion es Av Italia 1234' },
      ];

      const result = await orderExtractor.processOrderFromReply({
        rawReply: '¡Hemos registrado su pedido! Lo llamaremos al 099123456.',
        conversationId: 54322,
        accountId: 1,
        history,
        channel: 'whatsapp',
      });

      expect(result.createdOrder).toEqual(fakeOrder);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({ sku: 'PEDIDO-CHAT' }),
          ]),
        })
      );
    });
  });

  describe('H7: Redis Memory Store Timer Hygiene', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('Redis memory store correctly handles expiration and clearing without hanging handles', async () => {
      await redis.set('test_cleanup_key', 'val', 'EX', 10);
      const val = await redis.get('test_cleanup_key');
      expect(val).toBe('val');

      // Advance 11 seconds to trigger expiration
      jest.advanceTimersByTime(11000);
      const valExpired = await redis.get('test_cleanup_key');
      expect(valExpired).toBeNull();

      // Test active del clears timer
      await redis.set('test_cleanup_key2', 'val2', 'EX', 10);
      await redis.del('test_cleanup_key2');
      const valAfterDel = await redis.get('test_cleanup_key2');
      expect(valAfterDel).toBeNull();
    });
  });

  describe('H9: Rate Limiter Webhook Exemption & Security Against Query Bypasses', () => {
    let testApp;

    beforeAll(() => {
      testApp = express();
      // Mount apiLimiter under /api, mimicking real backend/index.js
      testApp.use('/api', apiLimiter, (req, res) => {
        res.status(200).json({ ok: true, path: req.path });
      });
    });

    test('Rate limiter skips legitimate /api/webhook endpoint', async () => {
      const res = await request(testApp).get('/api/webhook');
      expect(res.status).toBe(200);
      // In express-rate-limit, skipped requests do not set rate limit headers
      expect(res.headers['ratelimit-limit']).toBeUndefined();
    });

    test('Rate limiter skips /api/mercadopago/webhook endpoint', async () => {
      const res = await request(testApp).get('/api/mercadopago/webhook');
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBeUndefined();
    });

    test('Security: Query param bypass attempt (/api/productos?x=/webhook) is NOT skipped', async () => {
      const res = await request(testApp).get('/api/productos?x=/webhook');
      expect(res.status).toBe(200);
      // Not skipped: rate limit headers are applied
      expect(res.headers['ratelimit-limit']).toBe('100');
    });

    test('Standard API routes (/api/productos) apply rate limiting', async () => {
      const res = await request(testApp).get('/api/productos');
      expect(res.status).toBe(200);
      expect(res.headers['ratelimit-limit']).toBe('100');
    });
  });

  describe('H10: Express Body Parser Limit (HTTP 413 Payload Too Large)', () => {
    let testApp;

    beforeAll(() => {
      testApp = express();
      testApp.use(express.json({ limit: '1mb' }));
      testApp.use(express.urlencoded({ extended: true, limit: '1mb' }));
      testApp.post('/test-limit', (req, res) => res.status(200).json({ ok: true }));
      testApp.use((err, req, res, _next) => {
        const statusCode = err.status || err.statusCode || 500;
        res.status(statusCode).json({ error: err.message });
      });
    });

    test('Accepts valid payload within 1MB limit with 200 OK', async () => {
      const res = await request(testApp)
        .post('/test-limit')
        .send({ message: 'Texto normal dentro del límite' });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    test('Rejects oversized payload (> 1MB) with 413 Payload Too Large', async () => {
      const bigString = 'A'.repeat(1.1 * 1024 * 1024);
      const res = await request(testApp)
        .post('/test-limit')
        .send({ data: bigString });
      expect(res.status).toBe(413);
    });
  });

  describe('H11: Prompt Token Budget Safeguards', () => {
    beforeEach(() => {
      jest.spyOn(configuracionRepo, 'get').mockImplementation(async (key) => {
        if (key === 'system_prompt') return 'Prompt base de prueba Kroser';
        if (key === 'pedidos_enabled') return 'true';
        return null;
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('PromptBuilder truncates excessively large RAG contexts safely (max 4000)', async () => {
      const hugeRag = 'X'.repeat(6000);
      const prompt = await promptBuilder.buildSystemPrompt({
        ragContextStr: hugeRag,
      });

      expect(prompt).toContain('... [Contexto truncado por límite de tamaño]');
      expect(prompt).toContain('CONTEXTO ADICIONAL:');
      expect(prompt).toContain('X'.repeat(4000));
      expect(prompt).not.toContain('X'.repeat(4001));
    });

    test('PromptBuilder truncates excessively large customerProfileStr (max 1000)', async () => {
      const hugeProfile = 'P'.repeat(2500);
      const prompt = await promptBuilder.buildSystemPrompt({
        customerProfileStr: hugeProfile,
      });

      expect(prompt).toContain('... [Contexto truncado por límite de tamaño]');
      expect(prompt).toContain('P'.repeat(1000));
      expect(prompt).not.toContain('P'.repeat(1001));
    });

    test('PromptBuilder truncates excessively large trackingContextStr (max 1500)', async () => {
      const hugeTracking = 'T'.repeat(3000);
      const prompt = await promptBuilder.buildSystemPrompt({
        trackingContextStr: hugeTracking,
      });

      expect(prompt).toContain('... [Contexto truncado por límite de tamaño]');
      expect(prompt).toContain('INFORMACIÓN DE PEDIDO PREVIA:');
      expect(prompt).toContain('T'.repeat(1500));
      expect(prompt).not.toContain('T'.repeat(1501));
    });
  });
});
