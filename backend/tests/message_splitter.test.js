const messageSplitter = require('../utils/messageSplitter');
const promptBuilder = require('../services/webhook/promptBuilder');
const webhookService = require('../services/webhook/webhookService');
const chatwootService = require('../services/chatwoot/chatwootService');
const redis = require('../config/redis');
const conversacionesRepo = require('../repositories/conversacionesRepository');
const llmService = require('../services/llm/llmService');

describe('Message Splitter & Human Typing Pacing (Anti-Libro)', () => {
  describe('1. messageSplitter.splitIntoChunks', () => {
    test('mantiene mensajes cortos (< 110 chars) como un único globo', () => {
      const shortMsg = '¡Hola! Sí, disponemos de stock en la sucursal Centro a $1.290.';
      const chunks = messageSplitter.splitIntoChunks(shortMsg);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(shortMsg);
    });

    test('divide mensajes con párrafos explícitos en dos globos limpios', () => {
      const paragraphMsg =
        'Buenas tardes. Disponemos de pintura látex antihongo Inca de 4L a $1.450 en color blanco.\n\n¿En qué zona se encuentra para verificar el envío o la sucursal más cercana?';
      const chunks = messageSplitter.splitIntoChunks(paragraphMsg);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toContain('Inca de 4L a $1.450');
      expect(chunks[1]).toContain('¿En qué zona se encuentra');
    });

    test('divide respuestas largas con pregunta de cierre al final', () => {
      const responseWithQuestion =
        'Hola Juan. El taladro percutor Bosch GSB 13 RE tiene un costo de $2.490 y cuenta con 1 año de garantía oficial de fábrica. ¿Le gustaría que coordinemos el envío a domicilio o prefiere pasar a retirarlo?';
      const chunks = messageSplitter.splitIntoChunks(responseWithQuestion);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toContain('$2.490');
      expect(chunks[1]).toContain('¿Le gustaría');
    });

    test('NO divide dentro de números con separadores de miles o decimales ($2.490 o 1.5m)', () => {
      const priceMsg =
        'Contamos con rollo de cable unipolar de 1.5mm a $1.850 pesos y térmicas de 16A a $420. Si confirma la compra antes de las 14hs se lo despachamos en el día.';
      const chunks = messageSplitter.splitIntoChunks(priceMsg);
      // Ensure that neither $1.850 nor 1.5mm was chopped at the period
      expect(chunks.join(' ')).toContain('$1.850');
      expect(chunks.join(' ')).toContain('1.5mm');
      expect(chunks.length).toBeGreaterThanOrEqual(1);
    });

    test('descarta separadores markdown como --- o *** entre párrafos', () => {
      const msgWithHr = '¡Hola! Disponemos de pintura látex de 4L a $1.290.\n---\n¿Le gustaría coordinar el envío a domicilio?';
      const chunks = messageSplitter.splitIntoChunks(msgWithHr);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toContain('$1.290');
      expect(chunks[1]).toContain('¿Le gustaría coordinar el envío');
      expect(chunks.join(' ')).not.toContain('---');
    });

    test('maneja strings vacíos o nulos sin lanzar errores', () => {
      expect(messageSplitter.splitIntoChunks('')).toEqual([]);
      expect(messageSplitter.splitIntoChunks(null)).toEqual([]);
      expect(messageSplitter.splitIntoChunks(undefined)).toEqual([]);
    });
  });

  describe('2. PromptBuilder Anti-Testamento Directives', () => {
    test('incluye directivas explícitas contra muros de texto y fichas técnicas innecesarias', async () => {
      const prompt = await promptBuilder.buildSystemPrompt({ messageCount: 1 });
      expect(prompt).toContain('REGLA ANTI-TESTAMENTO');
      expect(prompt).toContain('CERO \'LIBROS\'');
      expect(prompt).toContain('PROHIBIDO VOLCAR FICHAS TÉCNICAS');
    });
  });

  describe('3. Integración en WebhookService con Despacho Fragmentado', () => {
    const testConvId = 889977;

    beforeEach(async () => {
      await redis.del(`conv_memory:${testConvId}`);
      await redis.del(`conv_buffer:${testConvId}`);
      await redis.del(`human_active:${testConvId}`);
    });

    test('envía múltiples mensajes y activa estado de tipeo entre fragmentos', async () => {
      const sendSpy = jest.spyOn(chatwootService, 'sendMessage').mockResolvedValue({ success: true, id: 9991 });
      const typingSpy = jest.spyOn(chatwootService, 'toggleTypingStatus').mockResolvedValue({ success: true });
      jest.spyOn(conversacionesRepo, 'logMessage').mockResolvedValue({});

      // Mock LLM returning a 2-part message
      jest.spyOn(llmService, 'generateWithTools').mockResolvedValue({
        reply:
          '¡Hola! Sí, disponemos de membrana líquida Sika de 20kg en stock a $3.890 pesos.\n\n¿Le gustaría coordinar el envío a domicilio o prefiere retirar en sucursal?',
        toolsUsed: [],
        createdOrder: null,
      });

      const payload = {
        event: 'message_created',
        message_type: 'incoming',
        content: 'Tienen membrana sika de 20kg?',
        conversation: { id: testConvId, channel: 'whatsapp' },
        sender: { id: 50, name: 'Martín Test' },
        account: { id: 1 },
      };

      const res = await webhookService.processWebhookEvent(payload);

      expect(res.status).toBe('processed');
      expect(res.chunks).toBeDefined();
      expect(res.chunks).toHaveLength(2);

      // Verify that sendMessage was called for each chunk
      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect(sendSpy).toHaveBeenNthCalledWith(1, 1, testConvId, expect.stringContaining('$3.890'));
      expect(sendSpy).toHaveBeenNthCalledWith(2, 1, testConvId, expect.stringContaining('¿Le gustaría'));

      // Verify typing status was toggled between chunks
      expect(typingSpy).toHaveBeenCalledWith(1, testConvId, 'on');
      expect(typingSpy).toHaveBeenCalledWith(1, testConvId, 'off');

      sendSpy.mockRestore();
      typingSpy.mockRestore();
    });
  });
});
