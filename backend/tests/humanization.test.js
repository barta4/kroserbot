const intentDetector = require('../services/webhook/intentDetector');
const promptBuilder = require('../services/webhook/promptBuilder');
const llmService = require('../services/llm/llmService');
const mediaService = require('../services/media/mediaService');
const customerMemoryService = require('../services/customer/customerMemoryService');
const webhookService = require('../services/webhook/webhookService');

describe('Humanización y Comportamiento Humano de KroserBot', () => {

  describe('1. Detector de Intenciones y Emociones (intentDetector)', () => {
    test('detecta saludo puro y saludo contextual', () => {
      const pure = intentDetector.detectIntent('Hola');
      expect(pure.hasGreeting).toBe(true);
      expect(pure.isPureGreeting).toBe(true);
      expect(pure.intent).toBe('saludo');

      const complex = intentDetector.detectIntent('Hola, ¿tienen stock de taladro Bosch y a cuánto está?');
      expect(complex.hasGreeting).toBe(true);
      expect(complex.isPureGreeting).toBe(false);
      expect(complex.intent).toBe('consulta_general');
    });

    test('genera saludo formal según hora de Uruguay', () => {
      const greeting = intentDetector.getTimeOfDayGreeting('Carlos');
      expect(greeting).toContain('Carlos');
      expect(greeting).toContain('Kroser');
      expect(greeting).toMatch(/buenos días|buenas tardes|buenas noches/i);
    });

    test('detecta despedida pura y genera respuesta formal', () => {
      const farewell = intentDetector.detectIntent('Muchas gracias por todo');
      expect(farewell.hasFarewell).toBe(true);
      expect(farewell.isPureFarewell).toBe(true);
      expect(farewell.intent).toBe('despedida');

      const msg = farewell.getFarewellMessage();
      expect(msg).toContain('Kroser');
    });

    test('detecta cancelaciones de pedido ampliadas', () => {
      expect(intentDetector.detectIntent('ya no lo quiero').isCancellation).toBe(true);
      expect(intentDetector.detectIntent('cancela el pedido por favor').isCancellation).toBe(true);
      expect(intentDetector.detectIntent('deseo anular mi pedido').isCancellation).toBe(true);
      expect(intentDetector.detectIntent('dejalo sin efecto').isCancellation).toBe(true);
    });

    test('detecta estados emocionales: frustrado y apurado', () => {
      const reclamo = intentDetector.detectIntent('Tengo un reclamo urgente, vino roto el producto');
      expect(reclamo.emotion).toBe('frustrado');
      expect(reclamo.isComplaint).toBe(true);

      const apurado = intentDetector.detectIntent('Lo necesito urgente para ya mismo');
      expect(apurado.emotion).toBe('apurado');
      expect(apurado.isUrgent).toBe(true);
    });
  });

  describe('2. Constructor de Prompt Formal y Humanizado (promptBuilder)', () => {
    test('construye prompt con trato formal de Usted y reglas anti-robot', async () => {
      const prompt = await promptBuilder.buildSystemPrompt({
        ragContextStr: 'PRODUCTOS: Taladro Bosch GSB 13 RE - $2.490',
        customerProfileStr: 'CLIENTE: Juan Perez',
        detectedEmotion: 'neutral',
        messageCount: 1,
        customerName: 'Juan',
      });

      expect(prompt).toContain('Usted');
      expect(prompt).toContain('Kroser');
      expect(prompt).toContain('Taladro Bosch');
      expect(prompt).toContain('DERIVAR:');
      expect(prompt).toContain('NUNCA diga "Como asistente virtual"');
    });

    test('evita reiterar saludos en mensajes posteriores', async () => {
      const promptTurn2 = await promptBuilder.buildSystemPrompt({
        ragContextStr: '',
        customerProfileStr: '',
        detectedEmotion: 'neutral',
        messageCount: 3,
        customerName: 'Juan',
      });

      expect(promptTurn2).toContain('NO vuelva a saludar');
    });

    test('adapta instrucciones ante clientes frustrados o apurados', async () => {
      const promptFrustrado = await promptBuilder.buildSystemPrompt({
        ragContextStr: '',
        customerProfileStr: '',
        detectedEmotion: 'frustrado',
        messageCount: 1,
      });
      expect(promptFrustrado).toContain('máxima empatía');

      const promptApurado = await promptBuilder.buildSystemPrompt({
        ragContextStr: '',
        customerProfileStr: '',
        detectedEmotion: 'apurado',
        messageCount: 1,
      });
      expect(promptApurado).toContain('sumamente directo');
    });

    test('incluye directivas de asesoramiento técnico y enlaces a productos en la web', async () => {
      const prompt = await promptBuilder.buildSystemPrompt({
        ragContextStr: 'PRODUCTOS RELEVANTES ENCONTRADOS EN CATÁLOGO:\n- SKU: YESO-01 | Placa Yeso Verde RH 12.5mm | Precio: $680\n  Enlace web: https://www.kroser.com.uy/placa-verde',
        customerProfileStr: '',
        detectedEmotion: 'neutral',
        messageCount: 1,
      });

      expect(prompt).toContain('ASESORAMIENTO TÉCNICO Y RESOLUCIÓN DE DUDAS');
      expect(prompt).toContain('ENLACES A PRODUCTOS EN LA TIENDA WEB');
      expect(prompt).toContain('https://www.kroser.com.uy/placa-verde');
    });
  });

  describe('3. Filtro Post-procesamiento y Desrobotización (llmService.cleanAndHumanizeReply)', () => {
    test('elimina muletillas y disclaimers de IA', () => {
      const rawAiResponse = 'Como asistente virtual de IA de Kroser, le informo que el precio es de $1.200. Espero que esta respuesta le sea de utilidad.';
      const cleaned = llmService.cleanAndHumanizeReply(rawAiResponse, 1);
      expect(cleaned).not.toContain('Como asistente virtual');
      expect(cleaned).not.toContain('Espero que esta respuesta le sea de utilidad');
      expect(cleaned).toContain('$1.200');
    });

    test('remueve saludos repetitivos si la conversación ya está avanzada', () => {
      const midConversationReply = '¡Hola! Por supuesto, disponemos de stock en la sucursal Centro.';
      const cleaned = llmService.cleanAndHumanizeReply(midConversationReply, 3);
      expect(cleaned).not.toMatch(/^¡?hola/i);
      expect(cleaned).toContain('Por supuesto, disponemos de stock');
    });
  });

  describe('4. Procesamiento de Adjuntos Multimedia (mediaService)', () => {
    test('procesa array de adjuntos vacío sin errores', async () => {
      const res = await mediaService.processMessageAttachments([]);
      expect(res.mediaSummaries).toEqual([]);
      expect(res.transcribedTexts).toEqual([]);
    });

    test('identifica y procesa notas de voz y audios', async () => {
      const attachments = [
        {
          file_type: 'audio',
          extension: '.ogg',
          data_url: 'https://fake-cdn.chatwoot.com/voice.ogg',
        },
      ];
      const res = await mediaService.processMessageAttachments(attachments);
      expect(res.mediaSummaries.length).toBe(1);
      expect(res.mediaSummaries[0]).toMatch(/Audio/);
    });

    test('identifica y procesa imágenes de productos', async () => {
      const attachments = [
        {
          file_type: 'image',
          extension: '.jpg',
          data_url: 'https://fake-cdn.chatwoot.com/photo.jpg',
        },
      ];
      const res = await mediaService.processMessageAttachments(attachments);
      expect(res.mediaSummaries.length).toBe(1);
      expect(res.mediaSummaries[0]).toMatch(/imagen/i);
    });
  });

  describe('5. Memoria de Cliente Inter-conversación (customerMemoryService)', () => {
    test('genera contexto de perfil y antecedentes sin fallar si no hay historial previo', async () => {
      const profile = await customerMemoryService.getCustomerProfileContext({
        conversationId: 999999,
        sender: { name: 'Roberto Gómez', phone_number: '+59899123456', email: 'roberto@example.com' },
      });
      expect(profile.name).toBe('Roberto Gómez');
      expect(profile.contextStr).toContain('Roberto Gómez');
      expect(profile.contextStr).toContain('+59899123456');
    });
  });

  describe('6. Flujo Integral de Webhook Humanizado', () => {
    test('procesa saludo puro con respuesta instantánea formal', async () => {
      const res = await webhookService.processWebhookEvent({
        event: 'message_created',
        message: { id: 77701, content: 'Buen día' },
        sender: { type: 'contact', name: 'Laura' },
        conversation: { id: 55501 },
      });

      expect(res.status).toBe('processed');
      expect(res.action).toBe('pure_greeting');
      expect(res.reply).toContain('Laura');
      expect(res.reply).toContain('Kroser');
    });

    test('procesa despedida pura con cierre formal', async () => {
      const res = await webhookService.processWebhookEvent({
        event: 'message_created',
        message: { id: 77702, content: 'Muchas gracias por la atención, nos vemos' },
        sender: { type: 'contact', name: 'Laura' },
        conversation: { id: 55502 },
      });

      expect(res.status).toBe('processed');
      expect(res.reply).toContain('Kroser');
    });
  });
});
