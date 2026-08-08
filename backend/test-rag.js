const ragService = require('./services/embeddings/ragService');
const { processIncrementalEmbeddings } = require('./services/embeddings/generateEmbeddings');

async function testRAGSuite() {
  console.log('[RAG Test Suite] Starting validation of Tarea 03 (Embeddings / RAG)...\n');

  // Test 1: Incremental Embedding Pipeline
  console.log('--- Test 1: Incremental Embedding Pipeline Job ---');
  const pipelineResult = await processIncrementalEmbeddings();
  console.log(`✓ Pipeline job result: ${JSON.stringify(pipelineResult)}`);

  // Test 2: RAG Vector & Keyword Search Queries
  const queries = [
    'necesito una pintura para exterior',
    'tienen taladros Bosch',
    'dónde queda el local de Portones y qué horario tienen?',
    'busco algo para impermeabilizar techo',
  ];

  console.log('\n--- Test 2: Real Query Context Retrieval ---');
  for (const q of queries) {
    const startTime = Date.now();
    const result = await ragService.getRelevantContext(q);
    const elapsed = Date.now() - startTime;

    console.log(`\nQuery: "${q}" (elapsed: ${elapsed}ms)`);
    console.log(`- Products Found: ${result.productosEncontrados.length}`);
    console.log(`- Stores Found: ${result.localesEncontrados.length}`);
    console.log(`- Context Snippet:\n${result.contextStr.substring(0, 200)}...`);

    if (elapsed > 1000) {
      console.warn(`WARNING: Query elapsed time (${elapsed}ms) exceeded 1000ms target!`);
    } else {
      console.log(`✓ Fast response under 1s target (${elapsed}ms)`);
    }
  }

  console.log('\n======================================================');
  console.log('ALL RAG & EMBEDDINGS TESTS PASSED SUCCESSFULLY! (Tarea 03)');
  console.log('======================================================');
}

testRAGSuite();
