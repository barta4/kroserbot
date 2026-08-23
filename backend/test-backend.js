const orderStateMachine = require('./services/pedidos/orderStateMachine');
const webhookService = require('./services/webhook/webhookService');
const configuracionRepo = require('./repositories/configuracionRepository');
const redis = require('./config/redis');

async function testBackendSuite() {
  console.log('[Backend Test Suite] Starting validation of Webhook, Orders, Human Takeover, & Channel Blocking...\n');

  // Test 1: Order State Machine Transitions
  console.log('--- Test 1: Order State Machine ---');
  try {
    orderStateMachine.assertTransition('pendiente', 'confirmado');
    console.log('✓ Valid transition: pendiente -> confirmado');
    orderStateMachine.assertTransition('pendiente', 'rechazado');
    console.log('✓ Valid transition: pendiente -> rechazado');
    orderStateMachine.assertTransition('pendiente', 'cancelado');
    console.log('✓ Valid transition: pendiente -> cancelado');

    try {
      orderStateMachine.assertTransition('rechazado', 'confirmado');
      console.error('FAILED: Invalid transition was allowed!');
      process.exit(1);
    } catch (err) {
      console.log(`✓ Correctly rejected invalid transition: ${err.message}`);
    }
  } catch (err) {
    console.error('State Machine Test Failed:', err.message);
    process.exit(1);
  }

  // Test 2: Webhook Event Shield & Idempotency
  console.log('\n--- Test 2: Webhook Event Shield & Idempotency ---');
  try {
    const bounceMsg = await webhookService.processWebhookEvent({
      event: 'message_created',
      message: { id: 9991, content: 'Mailer-Daemon: Mail delivery failed' },
      conversation: { id: 100 },
    });
    console.log(`✓ Bounce filter result: ${JSON.stringify(bounceMsg)}`);

    const normalMsg = await webhookService.processWebhookEvent({
      event: 'message_created',
      message: { id: 9992, content: 'Hola, tienen disponibilidad de pintura?' },
      conversation: { id: 101 },
    });
    console.log(`✓ Webhook message response: ${JSON.stringify(normalMsg)}`);

    const duplicateMsg = await webhookService.processWebhookEvent({
      event: 'message_created',
      message: { id: 9992, content: 'Hola, tienen disponibilidad de pintura?' },
      conversation: { id: 101 },
    });
    console.log(`✓ Idempotency dedup result: ${JSON.stringify(duplicateMsg)}`);
  } catch (err) {
    console.error('Webhook Service Test Failed:', err.message);
    process.exit(1);
  }

  // Test 3: Human Escalation Detection & Subsequent Silence
  console.log('\n--- Test 3: Human Escalation & Silence ---');
  try {
    const escalationTest = await webhookService.processWebhookEvent({
      event: 'message_created',
      message: { id: 9993, content: 'Tengo un reclamo sobre mi factura de compra' },
      conversation: { id: 102 },
    });
    console.log(`✓ Human escalation handler output: ${JSON.stringify(escalationTest)}`);
    if (escalationTest.action !== 'human_escalation') {
      throw new Error(`Expected action 'human_escalation', got: ${escalationTest.action}`);
    }

    // Now test that customer follow-up message is silenced
    const followUpMsg = await webhookService.processWebhookEvent({
      event: 'message_created',
      message: { id: 9994, content: 'Gracias por avisar, espero respuesta' },
      conversation: { id: 102 },
    });
    console.log(`✓ Customer follow-up after derivation silenced: ${JSON.stringify(followUpMsg)}`);
    if (followUpMsg.reason !== 'human_active') {
      throw new Error(`Expected reason 'human_active', got: ${followUpMsg.reason}`);
    }
  } catch (err) {
    console.error('Escalation Test Failed:', err.message);
    process.exit(1);
  }

  // Test 4: Direct Human Agent Takeover (sender.type === 'agent')
  console.log('\n--- Test 4: Direct Human Agent Takeover ---');
  try {
    const agentMsg = await webhookService.processWebhookEvent({
      event: 'message_created',
      message: { id: 9995, content: 'Hola, soy Martín de atención al cliente de Kroser. ¿En qué te ayudo?' },
      sender: { type: 'agent', id: 45, name: 'Martín' },
      conversation: { id: 103 },
    });
    console.log(`✓ Agent message ignored & silence flag set: ${JSON.stringify(agentMsg)}`);
    if (agentMsg.reason !== 'agent_message') {
      throw new Error(`Expected reason 'agent_message', got: ${agentMsg.reason}`);
    }

    // Verify customer subsequent message is silenced
    const customerMsg = await webhookService.processWebhookEvent({
      event: 'message_created',
      message: { id: 9996, content: 'Hola Martín, busco taladros' },
      sender: { type: 'contact' },
      conversation: { id: 103 },
    });
    console.log(`✓ Customer message silenced after agent takeover: ${JSON.stringify(customerMsg)}`);
    if (customerMsg.reason !== 'human_active') {
      throw new Error(`Expected reason 'human_active', got: ${customerMsg.reason}`);
    }
  } catch (err) {
    console.error('Agent Takeover Test Failed:', err.message);
    process.exit(1);
  }

  // Test 5: Chatwoot Conversation with Assigned Human Agent
  console.log('\n--- Test 5: Conversation Assigned to Human Agent ---');
  try {
    const assignedConvMsg = await webhookService.processWebhookEvent({
      event: 'message_created',
      message: { id: 9997, content: 'Hola, tengo una pregunta' },
      sender: { type: 'contact' },
      conversation: { id: 104, assignee_id: 12 },
    });
    console.log(`✓ Message in assigned conversation silenced: ${JSON.stringify(assignedConvMsg)}`);
    if (assignedConvMsg.reason !== 'assigned_to_human') {
      throw new Error(`Expected reason 'assigned_to_human', got: ${assignedConvMsg.reason}`);
    }
  } catch (err) {
    console.error('Assigned Conversation Test Failed:', err.message);
    process.exit(1);
  }

  // Test 6: Unassigning Conversation Reactivates Bot
  console.log('\n--- Test 6: Unassignment Reactivates Bot ---');
  try {
    const unassignEvent = await webhookService.processWebhookEvent({
      event: 'conversation_updated',
      conversation: { id: 104, assignee_id: null },
    });
    console.log(`✓ Unassign event processed: ${JSON.stringify(unassignEvent)}`);
    if (unassignEvent.action !== 'bot_reactivated') {
      throw new Error(`Expected action 'bot_reactivated', got: ${unassignEvent.action}`);
    }

    const reactivatedMsg = await webhookService.processWebhookEvent({
      event: 'message_created',
      message: { id: 9998, content: 'Tienen amoladoras angulares?' },
      sender: { type: 'contact' },
      conversation: { id: 104 },
    });
    console.log(`✓ Bot responds after reactivation: ${JSON.stringify(reactivatedMsg)}`);
    if (reactivatedMsg.status !== 'processed') {
      throw new Error(`Expected status 'processed', got: ${reactivatedMsg.status}`);
    }
  } catch (err) {
    console.error('Reactivation Test Failed:', err.message);
    process.exit(1);
  }

  // Test 7: Channel / Inbox Bot Blocking (e.g. Instagram 100% human)
  console.log('\n--- Test 7: Channel & Inbox Bot Blocking ---');
  try {
    // Configure disabled channels: Instagram and custom inbox 'inbox:77'
    await configuracionRepo.set('canales_desactivados', JSON.stringify(['instagram', 'inbox:77', 'ventas especiales']));

    // 7a: Incoming message from Instagram channel
    const instagramMsg = await webhookService.processWebhookEvent({
      event: 'message_created',
      message: { id: 99991, content: 'Hola por Instagram, tienen stock de pintura?' },
      conversation: { id: 105, channel: 'Channel::Instagram' },
    });
    console.log(`✓ Instagram message blocked for human attention: ${JSON.stringify(instagramMsg)}`);
    if (instagramMsg.reason !== 'channel_disabled' || instagramMsg.match !== 'instagram') {
      throw new Error(`Expected channel_disabled for instagram, got: ${JSON.stringify(instagramMsg)}`);
    }

    // 7b: Incoming message from custom blocked inbox
    const blockedInboxMsg = await webhookService.processWebhookEvent({
      event: 'message_created',
      message: { id: 99992, content: 'Consulta para ventas especiales' },
      conversation: { id: 106, inbox_id: 77 },
    });
    console.log(`✓ Blocked inbox message ignored for human attention: ${JSON.stringify(blockedInboxMsg)}`);
    if (blockedInboxMsg.reason !== 'channel_disabled' || blockedInboxMsg.match !== 'inbox:77') {
      throw new Error(`Expected channel_disabled for inbox:77, got: ${JSON.stringify(blockedInboxMsg)}`);
    }

    // 7c: Incoming message from enabled channel (WhatsApp)
    const whatsappMsg = await webhookService.processWebhookEvent({
      event: 'message_created',
      message: { id: 99993, content: 'Hola por WhatsApp, ¿tienen stock de martillos?' },
      conversation: { id: 107, channel: 'Channel::Whatsapp' },
    });
    console.log(`✓ Enabled WhatsApp channel processed by bot: ${JSON.stringify(whatsappMsg)}`);
    if (whatsappMsg.status !== 'processed') {
      throw new Error(`Expected status 'processed', got: ${whatsappMsg.status}`);
    }
  } catch (err) {
    console.error('Channel Blocking Test Failed:', err.message);
    process.exit(1);
  }

  console.log('\n======================================================');
  console.log('ALL INTEGRATION, HUMAN TAKEOVER & CHANNEL BLOCKING TESTS PASSED! ✓');
  console.log('======================================================');
}

testBackendSuite();
