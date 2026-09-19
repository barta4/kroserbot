const promptBuilder = require('../services/webhook/promptBuilder');
const toolExecutor = require('../services/webhook/toolExecutor');
const webhookService = require('../services/webhook/webhookService');
const configuracionRepo = require('../repositories/configuracionRepository');
const conversacionesRepo = require('../repositories/conversacionesRepository');
const localesRepo = require('../repositories/localesRepository');
const db = require('../config/db');
const redis = require('../config/redis');

describe('Suite de Blindaje de Prompt y Persistencia de Historial', () => {
  beforeEach(async () => {
    jest.restoreAllMocks();
  });

  describe('1. Control de Tamaño y Estructura en promptBuilder', () => {
    test('acota un base prompt de BD excesivo a máximo 4.000 caracteres', async () => {
      const hugeDbPrompt = 'A'.repeat(8000);
      jest.spyOn(configuracionRepo, 'get').mockImplementation(async (key) => {
        if (key === 'system_prompt') return hugeDbPrompt;
        return null;
      });

      const prompt = await promptBuilder.buildSystemPrompt({ messageCount: 1 });
      expect(prompt).toContain('... [Contexto truncado por límite de tamaño]');
      // The base prompt was truncated from 8,000 to 4,000 chars (total prompt < 9,000 vs 12,400 untruncated)
      expect(prompt.length).toBeLessThan(9000);
    });

    test('inyecta conversationSummaryStr en el System Prompt y acota a 1.000 caracteres si es excesivo', async () => {
      const summary = 'El cliente consultó previamente por amoladoras y discos de corte.';
      const prompt = await promptBuilder.buildSystemPrompt({
        conversationSummaryStr: summary,
      });

      expect(prompt).toContain('ANTECEDENTES DE ESTA CONVERSACIÓN (TURNOS PREVIOS RESUMIDOS):');
      expect(prompt).toContain(summary);

      // Oversized summary truncation
      const hugeSummary = 'B'.repeat(2000);
      const promptHuge = await promptBuilder.buildSystemPrompt({
        conversationSummaryStr: hugeSummary,
      });
      expect(promptHuge).toContain('... [Contexto truncado por límite de tamaño]');
    });
  });

  describe('2. Límites en Herramientas (Tool Execution Limits)', () => {
    test('executeBuscarSucursales acota los resultados a máximo 15 locales', async () => {
      const fakeLocales = Array.from({ length: 30 }, (_, i) => ({
        nombre: `Sucursal ${i + 1}`,
        zona: `Zona ${i + 1}`,
        direccion: `Direccion ${i + 1}`,
        telefono: '12345678',
        horario: '09:00 - 18:00',
      }));
      jest.spyOn(localesRepo, 'getAll').mockResolvedValue(fakeLocales);

      const res = await toolExecutor.executeTool('buscar_sucursales', {});
      expect(res.sucursales.length).toBe(15);
      expect(res.total_encontradas).toBe(30);
    });

    test('executeBuscarEnvio acota las zonas devueltas a máximo 15 zonas', async () => {
      const fakeZonas = Array.from({ length: 40 }, (_, i) => ({
        departamento_ciudad: `Depto ${i + 1}`,
        barrio_zona: `Barrio ${i + 1}`,
        costo_envio: '180',
        activo: true,
      }));
      jest.spyOn(db, 'query').mockResolvedValue({ rows: fakeZonas });

      const res = await toolExecutor.executeTool('buscar_envio', {});
      expect(res.zonas_envio.length).toBe(15);
      expect(res.total_encontradas).toBe(40);
    });
  });

  describe('3. Hidratación y Ventana Limpia de Historial en webhookService', () => {
    const testConvId = 99123;

    afterEach(async () => {
      await redis.del(`conv_memory:${testConvId}`);
      await redis.del(`conv_lock:${testConvId}`);
      await redis.del(`conv_buffer:${testConvId}`);
    });

    test('hidrata el historial desde la base de datos PostgreSQL cuando la clave de Redis está vacía', async () => {
      // Redis is clean
      await redis.del(`conv_memory:${testConvId}`);

      const dbHistory = [
        { rol: 'user', mensaje: 'Hola, tienen pintura latex?' },
        { rol: 'assistant', mensaje: 'Hola. Sí, disponemos de pintura látex para interiores y exteriores.' },
      ];
      jest.spyOn(conversacionesRepo, 'getHistory').mockResolvedValue(dbHistory);
      jest.spyOn(conversacionesRepo, 'logMessage').mockResolvedValue({});

      const llmService = require('../services/llm/llmService');
      let capturedUserMessages = null;
      jest.spyOn(llmService, 'generateWithTools').mockImplementation(async (sysPrompt, userMessages) => {
        capturedUserMessages = [...userMessages];
        return {
          reply: 'El balde de 20L cuesta $2.890.',
          toolsUsed: [],
          createdOrder: null,
        };
      });

      const payload = {
        event: 'message_created',
        message_type: 'incoming',
        content: '¿De cuántos litros vienen?',
        conversation: { id: testConvId, channel: 'whatsapp' },
        sender: { id: 10, name: 'Carlos Test' },
        account: { id: 1 },
      };

      await webhookService.processWebhookEvent(payload);

      // Verify that getHistory was called to hydrate missing Redis history
      expect(conversacionesRepo.getHistory).toHaveBeenCalledWith(testConvId, 20);

      // Verify that captured userMessages for LLM contains hydrated history + new message
      expect(capturedUserMessages).toHaveLength(3);
      expect(capturedUserMessages[0].content).toBe('Hola, tienen pintura latex?');
      expect(capturedUserMessages[1].content).toContain('Sí, disponemos de pintura látex');
      expect(capturedUserMessages[2].content).toBe('¿De cuántos litros vienen?');

      // Verify all roles are purely 'user' or 'assistant'
      capturedUserMessages.forEach((m) => {
        expect(['user', 'assistant']).toContain(m.role);
      });
    });

    test('trunca un mensaje de usuario excesivo (> 2500 chars) para evitar explosión de contexto', async () => {
      await redis.del(`conv_memory:${testConvId}`);
      const hugeUserText = 'Tengo una consulta técnica sobre taladros, amoladoras y discos para cortes de metal. '.repeat(40);

      const llmService = require('../services/llm/llmService');
      let capturedUserMessages = null;
      jest.spyOn(llmService, 'generateWithTools').mockImplementation(async (sysPrompt, userMessages) => {
        capturedUserMessages = [...userMessages];
        return { reply: 'Entendido, con gusto le oriento.', toolsUsed: [], createdOrder: null };
      });
      jest.spyOn(conversacionesRepo, 'logMessage').mockResolvedValue({});

      const payload = {
        event: 'message_created',
        message_type: 'incoming',
        content: hugeUserText,
        conversation: { id: testConvId, channel: 'whatsapp' },
        sender: { id: 10, name: 'Cliente Log' },
        account: { id: 1 },
      };

      await webhookService.processWebhookEvent(payload);

      const lastMsg = capturedUserMessages[capturedUserMessages.length - 1];
      expect(lastMsg.content.length).toBeLessThan(2600);
      expect(lastMsg.content).toContain('... [Mensaje truncado por longitud]');
    });

    test('mantiene alternancia pura sin rol "system" en ventana deslizante larga y envía resumen al prompt', async () => {
      // Seed Redis with 22 messages
      const seedHistory = [];
      for (let i = 1; i <= 22; i++) {
        seedHistory.push({
          role: i % 2 === 1 ? 'user' : 'assistant',
          content: `Mensaje número ${i}`,
        });
      }
      await redis.set(`conv_memory:${testConvId}`, JSON.stringify(seedHistory), 'EX', 86400);

      let capturedSystemPrompt = '';
      let capturedHistory = null;
      const llmService = require('../services/llm/llmService');
      jest.spyOn(llmService, 'generateWithTools').mockImplementation(async (sysPrompt, userMessages) => {
        capturedSystemPrompt = sysPrompt;
        capturedHistory = [...userMessages];
        return { reply: 'Respuesta al mensaje 23', toolsUsed: [], createdOrder: null };
      });
      jest.spyOn(conversacionesRepo, 'logMessage').mockResolvedValue({});

      const payload = {
        event: 'message_created',
        message_type: 'incoming',
        content: 'Pregunta número 23',
        conversation: { id: testConvId, channel: 'whatsapp' },
        sender: { id: 10, name: 'Cliente Frecuente' },
        account: { id: 1 },
      };

      await webhookService.processWebhookEvent(payload);

      // 1. System prompt contains summarized context of earlier messages
      expect(capturedSystemPrompt).toContain('ANTECEDENTES DE ESTA CONVERSACIÓN (TURNOS PREVIOS RESUMIDOS):');

      // 2. capturedHistory must NOT contain any 'system' role
      const hasSystemRole = capturedHistory.some((m) => m.role === 'system');
      expect(hasSystemRole).toBe(false);

      // 3. First message of sliding window must be 'user'
      expect(capturedHistory[0].role).toBe('user');
    });

    test('persiste la respuesta de derivación o fuera de horario en la memoria Redis de la sesión', async () => {
      await redis.del(`conv_memory:${testConvId}`);

      const chatwootService = require('../services/chatwoot/chatwootService');
      jest.spyOn(chatwootService, 'assignAgent').mockResolvedValue({ success: true });
      jest.spyOn(chatwootService, 'sendMessage').mockResolvedValue({ success: true });
      jest.spyOn(chatwootService, 'addLabels').mockResolvedValue({ success: true });
      jest.spyOn(conversacionesRepo, 'logMessage').mockResolvedValue({});

      const llmService = require('../services/llm/llmService');
      jest.spyOn(llmService, 'generateWithTools').mockResolvedValue({
        reply: 'DERIVAR: ecommerce',
        toolsUsed: [],
        createdOrder: null,
      });

      const payload = {
        event: 'message_created',
        message_type: 'incoming',
        content: 'Quiero hablar con un humano por favor',
        conversation: { id: testConvId, channel: 'whatsapp' },
        sender: { id: 10, name: 'Maria Derivada' },
        account: { id: 1 },
      };

      await webhookService.processWebhookEvent(payload);

      // Check that Redis conv_memory contains the user message AND the escalation/out-of-hours answer
      const rawStored = await redis.get(`conv_memory:${testConvId}`);
      expect(rawStored).not.toBeNull();
      const stored = JSON.parse(rawStored);

      expect(stored.length).toBeGreaterThanOrEqual(2);
      expect(stored[stored.length - 1].role).toBe('assistant');
      expect(stored[stored.length - 1].content.length).toBeGreaterThan(10);
    });
  });
});
