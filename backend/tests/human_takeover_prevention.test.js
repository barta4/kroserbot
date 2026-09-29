const webhookService = require('../services/webhook/webhookService');
const chatwootService = require('../services/chatwoot/chatwootService');
const configuracionRepo = require('../repositories/configuracionRepository');
const redis = require('../config/redis');

describe('Prevención de Auto-silenciamiento y Detección de Agentes Humanos', () => {
  const convId = 12320;
  const botAgentId = '42';

  beforeEach(async () => {
    await redis.del(`human_active:${convId}`);
    await redis.del(`conv_buffer:${convId}`);
    await redis.del(`msg_processed:99001`);
    await redis.del(`msg_processed:99002`);
    await redis.del(`msg_processed:99003`);
    await redis.del(`bot_sent_msg:99001`);
    await redis.del(`bot_sent_msg:99002`);
    await redis.del(`bot_sent_msg:99003`);
    await configuracionRepo.set('chatwoot_bot_agent_id', botAgentId);
  });

  afterAll(async () => {
    await redis.del(`human_active:${convId}`);
  });

  test('1. Mensaje saliente emitido por el bot no activa human_active ni silencia al bot', async () => {
    const msgId = 99001;
    // Simular que el bot acaba de enviar este mensaje saliente
    await redis.set(`bot_sent_msg:${msgId}`, '1', 'EX', 3600);

    const payload = {
      event: 'message_created',
      conversation: { id: convId, account_id: 1 },
      message: {
        id: msgId,
        content: '¡Hola! Bienvenido a Kroser, ¿en qué lo podemos asesorar?',
        message_type: 'outgoing',
        sender: { id: 42, type: 'user', name: 'KroserBot' },
      },
    };

    const res = await webhookService.processWebhookEvent(payload);
    expect(res.status).toBe('ignored');
    expect(res.reason).toBe('bot_self_message');

    // Comprobar que NO se silenció al bot en Redis
    const isHumanActive = await redis.get(`human_active:${convId}`);
    expect(isHumanActive).toBeNull();
  });

  test('2. Mensaje saliente con sender.id igual al botAgentId no activa human_active', async () => {
    const msgId = 99002;
    const payload = {
      event: 'message_created',
      conversation: { id: convId, account_id: 1 },
      message: {
        id: msgId,
        content: 'Disculpas por la demora, tenemos stock.',
        message_type: 'outgoing',
        sender: { id: 42, type: 'user', name: 'KroserBot' },
      },
    };

    const res = await webhookService.processWebhookEvent(payload);
    expect(res.status).toBe('ignored');
    expect(res.reason).toBe('bot_self_message');

    const isHumanActive = await redis.get(`human_active:${convId}`);
    expect(isHumanActive).toBeNull();
  });

  test('3. Mensaje saliente deduplicado (msg_processed pre-registrado) se descarta por idempotencia sin activar human_active', async () => {
    const msgId = 99003;
    await redis.set(`msg_processed:${msgId}`, '1', 'EX', 3600);

    const payload = {
      event: 'message_created',
      conversation: { id: convId, account_id: 1 },
      message: {
        id: msgId,
        content: 'Respuesta ya procesada',
        message_type: 'outgoing',
        sender: { id: 10, type: 'user' },
      },
    };

    const res = await webhookService.processWebhookEvent(payload);
    expect(res.status).toBe('ignored');
    expect(res.reason).toBe('duplicate_message');

    const isHumanActive = await redis.get(`human_active:${convId}`);
    expect(isHumanActive).toBeNull();
  });

  test('4. Notas privadas internas (private: true) se ignoran sin silenciar al bot', async () => {
    const payload = {
      event: 'message_created',
      conversation: { id: convId, account_id: 1 },
      message: {
        id: 99004,
        content: 'Nota interna privada de asesor o bot',
        message_type: 'outgoing',
        private: true,
        sender: { id: 99, type: 'agent' },
      },
    };

    const res = await webhookService.processWebhookEvent(payload);
    expect(res.status).toBe('ignored');
    expect(res.reason).toBe('private_note');

    const isHumanActive = await redis.get(`human_active:${convId}`);
    expect(isHumanActive).toBeNull();
  });

  test('5. Mensaje saliente de un agente humano real SÍ activa human_active y silencia al bot', async () => {
    const payload = {
      event: 'message_created',
      conversation: { id: convId, account_id: 1 },
      message: {
        id: 99005,
        content: 'Hola, soy Juan del mostrador. Te paso el presupuesto en un minuto.',
        message_type: 'outgoing',
        sender: { id: 88, type: 'agent', name: 'Juan Asesor' },
      },
    };

    const res = await webhookService.processWebhookEvent(payload);
    expect(res.status).toBe('ignored');
    expect(res.reason).toBe('agent_message');

    const isHumanActive = await redis.get(`human_active:${convId}`);
    expect(isHumanActive).toBe('1');
  });

  test('6. Asignación a botAgentId reactiva la conversación y limpia human_active', async () => {
    // Simular que previamente estaba silenciado
    await redis.set(`human_active:${convId}`, '1', 'EX', 3600);

    const payload = {
      event: 'conversation_updated',
      conversation: {
        id: convId,
        account_id: 1,
        assignee_id: 42, // Asignado al bot
      },
    };

    const res = await webhookService.processWebhookEvent(payload);
    expect(res.status).toBe('processed');
    expect(res.action).toBe('bot_reactivated');

    const isHumanActive = await redis.get(`human_active:${convId}`);
    expect(isHumanActive).toBeNull();
  });

  test('7. Asignación a un agente humano diferente al bot activa human_active', async () => {
    const payload = {
      event: 'conversation_updated',
      conversation: {
        id: convId,
        account_id: 1,
        assignee_id: 99, // Humano
      },
    };

    const res = await webhookService.processWebhookEvent(payload);
    expect(res.status).toBe('processed');
    expect(res.action).toBe('human_assigned');

    const isHumanActive = await redis.get(`human_active:${convId}`);
    expect(isHumanActive).toBe('1');
  });

  test('8. Condición de carrera: bot_sending activo reconoce el mensaje saliente como propio', async () => {
    // Simular que el bot está en medio de enviar el mensaje por HTTP
    await redis.set(`bot_sending:${convId}`, '1', 'EX', 30);

    const payload = {
      event: 'message_created',
      conversation: { id: convId, account_id: 1 },
      message: {
        id: 99008,
        content: 'Tenemos taladros inalámbricos Bosch de 12V y 18V.',
        message_type: 'outgoing',
        sender: { id: 999, type: 'user' },
      },
    };

    const res = await webhookService.processWebhookEvent(payload);
    expect(res.status).toBe('ignored');
    expect(res.reason).toBe('bot_self_message');

    const isHumanActive = await redis.get(`human_active:${convId}`);
    expect(isHumanActive).toBeNull();
  });

  test('9. Coincidencia de contenido: last_bot_reply coincide con el texto del mensaje saliente', async () => {
    const replyText = 'El costo de envío a Pocitos es de $250 o gratis superando $2000.';
    await redis.set(`last_bot_reply:${convId}`, replyText, 'EX', 120);

    const payload = {
      event: 'message_created',
      conversation: { id: convId, account_id: 1 },
      message: {
        id: 99009,
        content: replyText,
        message_type: 'outgoing',
        sender: { id: 999, type: 'user' },
      },
    };

    const res = await webhookService.processWebhookEvent(payload);
    expect(res.status).toBe('ignored');
    expect(res.reason).toBe('bot_self_message');

    const isHumanActive = await redis.get(`human_active:${convId}`);
    expect(isHumanActive).toBeNull();
  });

  test('10. Si botAgentId no está configurado (null), una conversación con assignee no silencia al bot', async () => {
    // Limpiar botAgentId para simular que no está configurado
    await redis.del('chatwoot_auto_bot_agent_id');
    await configuracionRepo.set('chatwoot_bot_agent_id', '');

    const payload = {
      event: 'conversation_updated',
      conversation: {
        id: convId,
        account_id: 1,
        assignee_id: 1, // Inbox asignó un agente por defecto
      },
    };

    const res = await webhookService.processWebhookEvent(payload);
    // No debe silenciar porque botAgentId no está configurado y no se sabe si es el bot
    const isHumanActive = await redis.get(`human_active:${convId}`);
    expect(isHumanActive).toBeNull();
  });

  test('11. Mensaje entrante (incoming) de un cliente cuyo contact ID coincide con botAgentId NUNCA se descarta como bot_self_message', async () => {
    await configuracionRepo.set('chatwoot_bot_agent_id', '42');
    const payload = {
      event: 'message_created',
      conversation: { id: convId, account_id: 1 },
      message: {
        id: 99011,
        content: '¿Tienen cinta aisladora 3M?',
        message_type: 'incoming',
        sender: { id: 42, type: 'contact', name: 'Cliente WhatsApp' },
      },
    };

    const res = await webhookService.processWebhookEvent(payload);
    expect(res.status).not.toBe('ignored');
    expect(res.reason).not.toBe('bot_self_message');
  });

  test('12. Mensaje entrante (incoming) cuyo contenido coincide parcialmente con last_bot_reply NUNCA se descarta como bot_self_message', async () => {
    await redis.set(`last_bot_reply:${convId}`, 'Hola, bienvenido a Ferreterías Kroser. ¿En qué te podemos ayudar?', 'EX', 120);
    const payload = {
      event: 'message_created',
      conversation: { id: convId, account_id: 1 },
      message: {
        id: 99012,
        content: 'Hola',
        message_type: 'incoming',
        sender: { id: 888, type: 'contact' },
      },
    };

    const res = await webhookService.processWebhookEvent(payload);
    expect(res.status).not.toBe('ignored');
    expect(res.reason).not.toBe('bot_self_message');
  });
});

