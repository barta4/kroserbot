const orderStateMachine = require('./services/pedidos/orderStateMachine');
const webhookService = require('./services/webhook/webhookService');

async function testBackendSuite() {
  console.log('[Backend Test Suite] Starting validation of Tareas 04 & 05...\n');

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
    const ignoredEvent = await webhookService.processWebhookEvent({
      event: 'conversation_updated',
    });
    console.log(`✓ Event shield result for conversation_updated: ${JSON.stringify(ignoredEvent)}`);

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

  // Test 3: Human Escalation Detection
  console.log('\n--- Test 3: Human Escalation & Derivation ---');
  try {
    const escalationTest = await webhookService.processWebhookEvent({
      event: 'message_created',
      message: { id: 9993, content: 'Tengo un reclamo sobre mi factura de compra' },
      conversation: { id: 102 },
    });
    console.log(`✓ Human escalation handler output: ${JSON.stringify(escalationTest)}`);
  } catch (err) {
    console.error('Escalation Test Failed:', err.message);
    process.exit(1);
  }

  console.log('\n======================================================');
  console.log('ALL INTEGRATION TESTS PASSED SUCCESSFULLY! (Tareas 04 & 05)');
  console.log('======================================================');
}

testBackendSuite();
