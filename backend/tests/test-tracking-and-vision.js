const orderTrackingService = require('../services/pedidos/orderTrackingService');
const mediaService = require('../services/media/mediaService');
const intentDetector = require('../services/webhook/intentDetector');
const promptBuilder = require('../services/webhook/promptBuilder');
const assert = require('assert');

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: TRACKING DE PEDIDOS & VISUAL PARTS FINDER');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  // TEST 1: Order Identifier Extraction
  try {
    console.log('▶ Test 1: Extracción de identificadores de pedido...');
    assert.strictEqual(orderTrackingService.extractOrderIdentifier('¿Cómo viene mi pedido #1042?'), '1042');
    assert.strictEqual(orderTrackingService.extractOrderIdentifier('Hola, quisiera saber el estado de la orden 5542'), '5542');
    assert.strictEqual(orderTrackingService.extractOrderIdentifier('Seguimiento pedido 9981 por favor'), '9981');
    assert.strictEqual(orderTrackingService.extractOrderIdentifier('Quiero rastrear la compra EC-8821'), 'EC-8821');
    assert.strictEqual(orderTrackingService.extractOrderIdentifier('Quiero comprar una pala'), null);
    console.log('  ✅ Extracción de IDs de pedido (#1042, orden 5542, EC-8821) exitosa');
    passed++;
  } catch (err) {
    console.error('  ❌ Test 1 Falló:', err.message);
    failed++;
  }

  // TEST 2: Order Tracking Status Formatting
  try {
    console.log('\n▶ Test 2: Formateo de mensajes de estado de pedido...');
    const mockPedidoPendiente = {
      id: 1042,
      estado: 'pendiente',
      cliente: { nombre: 'María González', direccion: 'Pocitos, Montevideo' },
      items: [{ nombre: 'Pintura Inca Látex 4L', cantidad: 1, precio: 32.50 }],
    };
    const replyPendiente = orderTrackingService.formatStatusMessage(mockPedidoPendiente);
    assert(replyPendiente.includes('#1042'), 'Debe incluir número de pedido');
    assert(replyPendiente.includes('María González'), 'Debe incluir nombre de cliente');
    assert(replyPendiente.includes('Pintura Inca'), 'Debe incluir resumen de artículos');
    assert(replyPendiente.includes('Revisión Comercial'), 'Debe indicar estado pendiente');
    console.log('  ✅ Estado Pendiente formateado correctamente');

    const mockPedidoPreparacion = {
      id: 2050,
      estado: 'en_preparacion',
      cliente: { nombre: 'Carlos Rodríguez', sucursal_retiro: 'Portones' },
      items: [{ nombre: 'Amoladora DeWalt 115mm', cantidad: 1, precio: 89.00 }],
    };
    const replyPrep = orderTrackingService.formatStatusMessage(mockPedidoPreparacion);
    assert(replyPrep.includes('En Preparación en Depósito'), 'Debe indicar estado en preparación');
    assert(replyPrep.includes('Portones'), 'Debe indicar sucursal de retiro');
    console.log('  ✅ Estado En Preparación & Retiro formateado correctamente');

    passed++;
  } catch (err) {
    console.error('  ❌ Test 2 Falló:', err.message);
    failed++;
  }

  // TEST 3: Intent Detector - Order Tracking
  try {
    console.log('\n▶ Test 3: Detección de Intención de Tracking...');
    const resTracking1 = intentDetector.detectIntent('¿Cómo viene mi pedido?');
    assert(resTracking1.isTracking, 'Debe detectar intención de tracking');
    assert.strictEqual(resTracking1.intent, 'tracking_pedido');

    const resTracking2 = intentDetector.detectIntent('Quiero consultar el estado de mi compra #304');
    assert(resTracking2.isTracking, 'Debe detectar intención de tracking con hashtag');
    assert.strictEqual(resTracking2.intent, 'tracking_pedido');

    const resConsultaNormal = intentDetector.detectIntent('¿Cuánto cuesta el taladro percutor?');
    assert(!resConsultaNormal.isTracking, 'No debe confundir consulta de precio con tracking');

    console.log('  ✅ Intención tracking_pedido detectada con precisión');
    passed++;
  } catch (err) {
    console.error('  ❌ Test 3 Falló:', err.message);
    failed++;
  }

  // TEST 4: Visual Parts Finder (Image Attachment Processing Mock)
  try {
    console.log('\n▶ Test 4: Procesamiento de Repuestos por Visión...');
    const mockAttachments = [
      {
        file_type: 'image',
        extension: 'jpg',
        url: 'https://example.com/repuesto_canilla.jpg',
      },
    ];

    const result = await mediaService.processMessageAttachments(mockAttachments);
    assert(Array.isArray(result.mediaSummaries), 'Debe retornar mediaSummaries');
    assert(result.mediaSummaries.length === 1, 'Debe procesar 1 imagen');
    console.log('  ✅ Procesamiento de imagen en mediaService validado');

    passed++;
  } catch (err) {
    console.error('  ❌ Test 4 Falló:', err.message);
    failed++;
  }

  // TEST 5: Prompt Builder with Tracking & Visual Parts Rules
  try {
    console.log('\n▶ Test 5: Inyección de Reglas de Tracking y Visión en Prompt...');
    const trackingContext = `ESTADO DE PEDIDO ENCONTRADO EN SISTEMA:
- Pedido: #1042
- Estado actual: EN_PREPARACION
- Detalle: Estimado Carlos, su pedido #1042 está En Preparación en Depósito.\n\n`;

    const prompt = await promptBuilder.buildSystemPrompt({
      ragContextStr: '\n[Productos relevantes de catálogo]',
      customerProfileStr: '',
      trackingContextStr: trackingContext,
      detectedEmotion: 'neutral',
      messageCount: 2,
      customerName: 'Carlos',
    });

    assert(prompt.includes('RECONOCIMIENTO VISUAL DE REPUESTOS Y PIEZAS (VISUAL PARTS FINDER)'), 'Debe incluir regla de visión');
    assert(prompt.includes('SEGUIMIENTO Y TRACKING DE PEDIDOS (AUTOSERVICIO)'), 'Debe incluir regla de tracking');
    assert(prompt.includes('ESTADO DE PEDIDO ENCONTRADO EN SISTEMA'), 'Debe contener el contexto de pedido inyectado');
    assert(prompt.includes('#1042'), 'Debe contener la referencia del pedido');

    console.log('  ✅ System Prompt enriquecido con Tracking y Visual Parts Finder');
    passed++;
  } catch (err) {
    console.error('  ❌ Test 5 Falló:', err.message);
    failed++;
  }

  console.log('\n------------------------------------------------------');
  console.log(`📊 RESULTADO FINAL: ${passed} Pasados, ${failed} Fallados`);
  console.log('------------------------------------------------------\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
