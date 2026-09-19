const botLoopDetector = require('../services/guardrails/botLoopDetector');
const webhookService = require('../services/webhook/webhookService');
const redis = require('../config/redis');

describe('Protección contra Bucles Infinitos de Bots (Bot Loop Shield)', () => {
  beforeEach(async () => {
    // Resetear claves de prueba en memoria / Redis
    await redis.del('bot_turns:8001');
    await redis.del('bot_turns:8002');
    await redis.del('bot_turns:8003');
    await redis.del('recent_in_msgs:8001');
    await redis.del('recent_in_msgs:8002');
    await redis.del('conv_memory:8001');
    await redis.del('conv_memory:8002');
    await redis.del('human_active:8001');
    await redis.del('human_active:8002');
    await redis.del('human_active:8003');
  });

  describe('1. Detección de Auto-respondedores y Fuera de Horario', () => {
    test('detecta mensaje típico de fuera de horario y horarios de atención', () => {
      const text = 'Gracias por comunicarte con nosotros. Nuestro horario de atención es de lunes a viernes de 9 a 18 hs.';
      const res = botLoopDetector.isAutoResponderOrIVR(text);

      expect(res).toBeTruthy();
      expect(res.isBot).toBe(true);
      expect(res.category).toBe('auto_responder');
    });

    test('detecta respuestas automáticas y mensajes de ausencia', () => {
      const text1 = 'Mensaje automático: En este momento no estamos disponibles, te responderemos a la brevedad.';
      const res1 = botLoopDetector.isAutoResponderOrIVR(text1);
      expect(res1.isBot).toBe(true);

      const text2 = 'Out of office: Regreso de vacaciones el próximo lunes.';
      const res2 = botLoopDetector.isAutoResponderOrIVR(text2);
      expect(res2.isBot).toBe(true);
    });

    test('NO bloquea preguntas legítimas de clientes humanos sobre horarios o disponibilidad', () => {
      const normalQueries = [
        'Hola buenas tardes, ¿cuál es su horario de atención en la tienda?',
        'Hola, ¿tienen abierto hoy sábado?',
        'Buenas, quería consultar el precio de un taladro percutor Bosch',
        'Hola, ¿me pueden responder si tienen stock de pintura blanca?',
      ];

      for (const query of normalQueries) {
        const res = botLoopDetector.isAutoResponderOrIVR(query);
        expect(res).toBe(false);
      }
    });
  });

  describe('2. Detección de Menús IVR y Opciones Interactivas', () => {
    test('detecta opciones estructuradas numeradas tipo menú telefónico o bot', () => {
      const ivrMenu = `Bienvenido al canal de atención.
1- Ventas y cotizaciones
2- Envíos y entregas
3- Reclamos y garantías`;

      const res = botLoopDetector.isAutoResponderOrIVR(ivrMenu);
      expect(res).toBeTruthy();
      expect(res.isBot).toBe(true);
      expect(res.category).toBe('ivr_menu_list');
    });

    test('detecta indicador explícito de selección de menú', () => {
      const text = 'Por favor seleccione una opción para continuar con su atención.';
      const res = botLoopDetector.isAutoResponderOrIVR(text);
      expect(res).toBeTruthy();
      expect(res.isBot).toBe(true);
      expect(res.category).toBe('ivr_menu');
    });

    test('NO confunde cantidades de productos de un cliente humano con menú IVR', () => {
      const customerOrder = 'Hola, preciso comprar 1 taladro percutor de 13mm y 2 discos de corte';
      const res = botLoopDetector.isAutoResponderOrIVR(customerOrder);
      expect(res).toBe(false);
    });
  });

  describe('3. Detección de Bots de Terceros / Asistentes IA', () => {
    test('detecta cuando el interlocutor se autoidentifica como bot o asistente virtual', () => {
      const botText = '¡Hola! Soy un asistente virtual de Pinturas Central, ¿en qué te puedo asesorar?';
      const res = botLoopDetector.isAutoResponderOrIVR(botText);
      expect(res).toBeTruthy();
      expect(res.isBot).toBe(true);
      expect(res.category).toBe('bot_identity');
    });
  });

  describe('4. Supresión de Espiral de Cortesía (Farewell Loop Prevention)', () => {
    test('suprime despedida si el asistente ya se despidió y el usuario solo dice "muchas gracias"', () => {
      const history = [
        { role: 'user', content: '¿Tienen cinta aisladora?' },
        { role: 'assistant', content: 'Sí, disponemos de cinta 3M a $85.' },
        { role: 'user', content: 'Genial, paso más tarde.' },
        { role: 'assistant', content: 'Muchas gracias por comunicarse con Kroser. ¡Que tenga un excelente día! Quedamos a las órdenes.' },
      ];

      const incomingFarewell = 'Muchas gracias, que pases bien!';
      const shouldSuppress = botLoopDetector.shouldSuppressFarewell(history, incomingFarewell);
      expect(shouldSuppress).toBe(true);
    });

    test('NO suprime despedida si el asistente todavía no se había despedido', () => {
      const history = [
        { role: 'user', content: '¿Aceptan Mercado Pago?' },
        { role: 'assistant', content: 'Sí, aceptamos Mercado Pago, tarjetas y efectivo.' },
      ];

      const incomingFarewell = 'Impecable, muchas gracias por la info, chau!';
      const shouldSuppress = botLoopDetector.shouldSuppressFarewell(history, incomingFarewell);
      expect(shouldSuppress).toBe(false);
    });
  });

  describe('5. Detección de Mensajes Repetitivos Cíclicos (Repetitive Loop)', () => {
    test('detecta bucle cuando el mismo mensaje exacto llega 3 veces consecutivas', async () => {
      const convId = 8001;
      const stuckMsg = 'Opción no válida. Por favor digite su número de consulta.';

      const check1 = await botLoopDetector.checkAndTrackRepetition(convId, stuckMsg);
      expect(check1.isLoop).toBe(false);

      const check2 = await botLoopDetector.checkAndTrackRepetition(convId, stuckMsg);
      expect(check2.isLoop).toBe(false);

      const check3 = await botLoopDetector.checkAndTrackRepetition(convId, stuckMsg);
      expect(check3.isLoop).toBe(true);
      expect(check3.reason).toBe('repetitive_message_loop');
    });

    test('no marca bucle si los mensajes varían', async () => {
      const convId = 8002;
      await botLoopDetector.checkAndTrackRepetition(convId, 'Consulta sobre amoladoras');
      await botLoopDetector.checkAndTrackRepetition(convId, '¿Tienen discos de diamante?');
      const check3 = await botLoopDetector.checkAndTrackRepetition(convId, '¿Cuánto sale el envío a Carrasco?');
      expect(check3.isLoop).toBe(false);
    });
  });

  describe('6. Circuit Breaker de Turnos Consecutivos de Bot', () => {
    test('incrementa turnos y dispara el límite cuando alcanza el umbral configurado', async () => {
      const convId = 8003;

      // Realizar 14 turnos
      for (let i = 1; i <= 14; i++) {
        const turn = await botLoopDetector.checkAndIncrementTurns(convId);
        expect(turn.turnCount).toBe(i);
        expect(turn.isLimitReached).toBe(false);
      }

      // Turno 15 (umbral por defecto)
      const turn15 = await botLoopDetector.checkAndIncrementTurns(convId);
      expect(turn15.turnCount).toBe(15);
      expect(turn15.isLimitReached).toBe(true);
    });

    test('resetTurns reinicia correctamente el contador a cero', async () => {
      const convId = 8003;
      await botLoopDetector.checkAndIncrementTurns(convId);
      await botLoopDetector.checkAndIncrementTurns(convId);

      await botLoopDetector.resetTurns(convId);

      const turnAfterReset = await botLoopDetector.checkAndIncrementTurns(convId);
      expect(turnAfterReset.turnCount).toBe(1);
    });
  });

  describe('7. Integración End-to-End en Webhook', () => {
    test('mensaje de autorespondedor es descartado en silencio (ignored)', async () => {
      const payload = {
        event: 'message_created',
        conversation: { id: 8901, account_id: 1 },
        message: {
          id: 99111,
          content: 'Gracias por comunicarse. Nuestro horario de atención es de lunes a viernes de 9 a 18.',
        },
        sender: { type: 'contact', name: 'Contestador Empresa' },
      };

      const result = await webhookService.processWebhookEvent(payload);
      expect(result.status).toBe('ignored');
      expect(result.reason).toBe('auto_responder_detected');
    });

    test('espiral de cortesía tras despedida previa es finalizada sin re-responder', async () => {
      const convId = 8902;
      // Simular historial donde el asistente ya cerró
      const sessionKey = `conv_memory:${convId}`;
      const history = [
        { role: 'user', content: '¿Tienen amoladora?' },
        { role: 'assistant', content: 'Muchas gracias por comunicarse con Kroser. ¡Que tenga un excelente día!' },
      ];
      await redis.set(sessionKey, JSON.stringify(history), 'EX', 86400);

      const payload = {
        event: 'message_created',
        conversation: { id: convId, account_id: 1 },
        message: {
          id: 99112,
          content: 'Muchas gracias a vos, que pases lindo!',
        },
        sender: { type: 'contact', name: 'Cliente' },
      };

      const result = await webhookService.processWebhookEvent(payload);
      expect(result.status).toBe('ignored');
      expect(result.reason).toBe('farewell_loop_prevented');
    });

    test('circuit breaker se dispara al alcanzar el límite de turnos', async () => {
      const convId = 8903;
      // Fijar turnos en 14 para que el próximo sea el 15
      await redis.set(`bot_turns:${convId}`, '14');

      const payload = {
        event: 'message_created',
        conversation: { id: convId, account_id: 1 },
        message: {
          id: 99113,
          content: 'Quisiera consultar otro producto más por favor',
        },
        sender: { type: 'contact', name: 'Cliente Conversador' },
      };

      const result = await webhookService.processWebhookEvent(payload);
      expect(result.status).toBe('processed');
      expect(result.action).toBe('turn_limit_reached');

      // Verificar que se silenció al bot en Redis
      const isHumanActive = await redis.get(`human_active:${convId}`);
      expect(isHumanActive).toBe('1');
    });
  });
});
