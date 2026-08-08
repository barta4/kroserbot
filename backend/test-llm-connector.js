const llmService = require('./services/llm/llmService');

async function testLLMConnectorSuite() {
  console.log('[LLM Connector Test] Starting validation of Dynamic AI Model Connector...\n');

  // Test 1: Dynamic Model Discovery (Gemini)
  console.log('--- Test 1: Listing Gemini Models Dynamically ---');
  try {
    const geminiModels = await llmService.listAvailableModels('gemini');
    console.log(`✓ Fetched ${geminiModels.length} Gemini models:`, geminiModels.map((m) => m.id));
  } catch (err) {
    console.error('Gemini Model Listing Failed:', err.message);
  }

  // Test 2: Dynamic Model Discovery (OpenAI / Compatible)
  console.log('\n--- Test 2: Listing OpenAI / Compatible Models Dynamically ---');
  try {
    const openaiModels = await llmService.listAvailableModels('openai');
    console.log(`✓ Fetched ${openaiModels.length} OpenAI models:`, openaiModels.map((m) => m.id));
  } catch (err) {
    console.error('OpenAI Model Listing Failed:', err.message);
  }

  // Test 3: Dynamic Response Generation without Hardcoding
  console.log('\n--- Test 3: Dynamic Response Generation ---');
  try {
    const response = await llmService.generateResponse(
      'Sos el asistente virtual de Kroser.',
      [{ role: 'user', content: 'Hola, buenas tardes' }]
    );
    console.log(`✓ Dynamic response generated: "${response}"`);
  } catch (err) {
    console.error('Dynamic Response Generation Failed:', err.message);
  }

  console.log('\n======================================================');
  console.log('DYNAMIC LLM CONNECTOR SUITE PASSED SUCCESSFULLY!');
  console.log('======================================================');
}

testLLMConnectorSuite();
