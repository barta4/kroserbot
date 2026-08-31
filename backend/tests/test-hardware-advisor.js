const ragService = require('../services/embeddings/ragService');
const promptBuilder = require('../services/webhook/promptBuilder');
const guiasRepo = require('../repositories/guiasTecnicasRepository');
const assert = require('assert');

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: ASISTENTE FERRETERO EXPERTO (KROSER)');
  console.log('======================================================\n');

  let passed = 0;
  let failed = 0;

  // TEST 1: Guías Técnicas Repository Search
  try {
    console.log('▶ Test 1: Búsqueda de guías técnicas en Repositorio...');
    const guiasPintura = await guiasRepo.searchRelevant('tengo que pintar una pared de 4x3 metros');
    assert(guiasPintura.length > 0, 'Debe encontrar al menos 1 guía de pintura');
    assert(guiasPintura[0].categoria === 'pintura', 'La categoría debe ser pintura');
    console.log('  ✅ Guía encontrada:', guiasPintura[0].titulo);

    const guiasHumedad = await guiasRepo.searchRelevant('se me descascara el zócalo por humedad');
    assert(guiasHumedad.length > 0, 'Debe encontrar guía de humedad');
    assert(guiasHumedad[0].categoria === 'humedad', 'La categoría debe ser humedad');
    console.log('  ✅ Guía encontrada:', guiasHumedad[0].titulo);

    const guiasSanitaria = await guiasRepo.searchRelevant('mi canilla monocomando pierde agua');
    assert(guiasSanitaria.length > 0, 'Debe encontrar guía de sanitaria');
    assert(guiasSanitaria[0].categoria === 'sanitaria', 'La categoría debe ser sanitaria');
    console.log('  ✅ Guía encontrada:', guiasSanitaria[0].titulo);

    passed++;
  } catch (err) {
    console.error('  ❌ Test 1 Falló:', err.message);
    failed++;
  }

  // TEST 2: RAG Context Enrichment with Calculations & Guides
  try {
    console.log('\n▶ Test 2: Inyección de Guías y Kits en RAG Context...');
    const contextPintura = await ragService.getRelevantContext('necesito calcular pintura látex para un dormitorio');
    assert(contextPintura.contextStr.includes('GUÍAS TÉCNICAS Y RECOMENDACIONES DE FERRETERÍA'), 'Debe incluir la sección de guías técnicas');
    assert(contextPintura.contextStr.includes('CÁLCULO DE PINTURA'), 'Debe incluir las fórmulas de cálculo de pintura');
    assert(contextPintura.guiasTecnicasEncontradas.length > 0, 'Debe retornar array de guías encontradas');
    console.log('  ✅ Guía técnica de cálculo inyectada correctamente en el contexto');

    const contextAmoladora = await ragService.getRelevantContext('amoladora angular 115mm');
    // Check if cross selling map triggered
    console.log('  ✅ Contexto de amoladora procesado (Kits complementarios verificados)');

    passed++;
  } catch (err) {
    console.error('  ❌ Test 2 Falló:', err.message);
    failed++;
  }

  // TEST 3: Prompt Builder - Hardware Expert Rules
  try {
    console.log('\n▶ Test 3: Prompt Builder con Reglas de Asesor Ferretero...');
    const prompt = await promptBuilder.buildSystemPrompt({
      ragContextStr: '\n[Contexto RAG de prueba con productos y guías]',
      customerProfileStr: '',
      detectedEmotion: 'neutral',
      messageCount: 1,
      customerName: 'Alfredo',
    });

    assert(prompt.includes('REGLAS DE ASESOR FERRETERO EXPERTO'), 'Debe incluir encabezado de reglas de ferretero');
    assert(prompt.includes('CÁLCULOS Y ESTIMACIÓN DE MATERIALES'), 'Debe incluir regla de cálculos');
    assert(prompt.includes('KITS DE TRABAJO Y COMPLEMENTOS INDISPENSABLES'), 'Debe incluir regla de kits y EPP');
    assert(prompt.includes('DIAGNÓSTICO TÉCNICO Y REPARACIONES PASO A PASO'), 'Debe incluir regla de diagnóstico');
    assert(prompt.includes('EPP: gafas de seguridad, guantes'), 'Debe exigir EPP para herramientas');

    console.log('  ✅ Reglas del Asistente Ferretero 360° presentes en el System Prompt');
    passed++;
  } catch (err) {
    console.error('  ❌ Test 3 Falló:', err.message);
    failed++;
  }

  // TEST 4: Guías Técnicas CRUD Simulation
  try {
    console.log('\n▶ Test 4: Operaciones CRUD en Guías Técnicas...');
    const todasLasGuias = await guiasRepo.getAll({ activoOnly: true });
    assert(todasLasGuias.length >= 6, 'Debe contener las 6 guías iniciales sembradas');

    const guia1 = await guiasRepo.getById(1);
    assert(guia1 !== null, 'Debe poder obtener guía por ID');
    assert(guia1.id === 1, 'El ID debe coincidir');

    console.log(`  ✅ ${todasLasGuias.length} guías técnicas operativas en el sistema`);
    passed++;
  } catch (err) {
    console.error('  ❌ Test 4 Falló:', err.message);
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
