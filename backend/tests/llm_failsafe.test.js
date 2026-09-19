const llmService = require('../services/llm/llmService');
const configuracionRepo = require('../repositories/configuracionRepository');

// Mock axios
jest.mock('axios');
const axios = require('axios');

describe('LLM Fail-Safe & Multi-Model Selection System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('1. Ejecuta proveedor primario con modelo seleccionado si no hay errores', async () => {
    jest.spyOn(configuracionRepo, 'get').mockImplementation(async (key) => {
      if (key === 'llm_provider') return 'gemini';
      if (key === 'llm_model') return 'gemini-1.5-pro';
      if (key === 'llm_api_key') return 'mock_gemini_key';
      if (key === 'llm_failsafe_enabled') return 'true';
      if (key === 'llm_fallback_provider') return 'openai';
      if (key === 'llm_fallback_model') return 'gpt-4o';
      if (key === 'llm_fallback_api_key') return 'mock_openai_key';
      return null;
    });

    const mockPost = jest.fn().mockResolvedValue({
      data: {
        candidates: [
          {
            content: {
              parts: [{ text: 'Respuesta generada por Gemini 1.5 Pro' }],
            },
          },
        ],
      },
    });
    axios.post.mockImplementation(mockPost);

    const res = await llmService.generateWithTools(
      'Instrucción de prueba',
      [{ role: 'user', content: '¿Tienen amoladoras?' }],
      {}
    );

    expect(res.reply).toContain('Respuesta generada por Gemini 1.5 Pro');
    // Verify it called Gemini model endpoint with chosen model
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost.mock.calls[0][0]).toContain('gemini-1.5-pro:generateContent');
  });

  test('2. Conmuta automáticamente a OpenAI (con su modelo y clave elegidos) si Gemini arroja error 429', async () => {
    jest.spyOn(configuracionRepo, 'get').mockImplementation(async (key) => {
      if (key === 'llm_provider') return 'gemini';
      if (key === 'llm_model') return 'gemini-1.5-flash';
      if (key === 'llm_api_key') return 'mock_gemini_key';
      if (key === 'llm_failsafe_enabled') return 'true';
      if (key === 'llm_fallback_provider') return 'openai';
      if (key === 'llm_fallback_model') return 'gpt-4o-mini';
      if (key === 'llm_fallback_api_key') return 'mock_openai_key';
      return null;
    });

    const mockPost = jest.fn()
      // First call (Gemini) fails with rate limit 429
      .mockRejectedValueOnce(new Error('Google API Error 429: Resource Exhausted'))
      // Second call (OpenAI fallback) succeeds
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: 'Respuesta generada por OpenAI GPT-4o Mini tras el fail-safe',
              },
            },
          ],
        },
      });
    axios.post.mockImplementation(mockPost);

    const res = await llmService.generateWithTools(
      'Instrucción de prueba',
      [{ role: 'user', content: '¿Cuánto cuesta el taladro?' }],
      {}
    );

    expect(res.reply).toContain('Respuesta generada por OpenAI GPT-4o Mini tras el fail-safe');
    expect(mockPost).toHaveBeenCalledTimes(2);

    // Call 1: Gemini
    expect(mockPost.mock.calls[0][0]).toContain('gemini-1.5-flash:generateContent');

    // Call 2: OpenAI Fallback with chosen model
    expect(mockPost.mock.calls[1][0]).toContain('/chat/completions');
    expect(mockPost.mock.calls[1][1].model).toBe('gpt-4o-mini');
    expect(mockPost.mock.calls[1][2].headers.Authorization).toBe('Bearer mock_openai_key');
  });

  test('3. Conmuta automáticamente a Gemini si OpenAI es primario y falla con 500', async () => {
    jest.spyOn(configuracionRepo, 'get').mockImplementation(async (key) => {
      if (key === 'llm_provider') return 'openai';
      if (key === 'llm_model') return 'gpt-4o';
      if (key === 'llm_api_key') return 'mock_openai_key';
      if (key === 'llm_failsafe_enabled') return 'true';
      if (key === 'llm_fallback_provider') return 'gemini';
      if (key === 'llm_fallback_model') return 'gemini-2.0-flash';
      if (key === 'llm_fallback_api_key') return 'mock_gemini_key';
      return null;
    });

    const mockPost = jest.fn()
      // First call (OpenAI) fails with 500
      .mockRejectedValueOnce(new Error('OpenAI API Error 500: Server Error'))
      // Second call (Gemini fallback) succeeds
      .mockResolvedValueOnce({
        data: {
          candidates: [
            {
              content: {
                parts: [{ text: 'Respuesta de respaldo generada por Gemini 2.0 Flash' }],
              },
            },
          ],
        },
      });
    axios.post.mockImplementation(mockPost);

    const res = await llmService.generateWithTools(
      'Instrucción de prueba',
      [{ role: 'user', content: 'Hola, tienen pintura?' }],
      {}
    );

    expect(res.reply).toContain('Respuesta de respaldo generada por Gemini 2.0 Flash');
    expect(mockPost).toHaveBeenCalledTimes(2);

    // Call 1: OpenAI
    expect(mockPost.mock.calls[0][0]).toContain('/chat/completions');
    expect(mockPost.mock.calls[0][1].model).toBe('gpt-4o');

    // Call 2: Gemini fallback with chosen model
    expect(mockPost.mock.calls[1][0]).toContain('gemini-2.0-flash:generateContent');
  });

  test('4. Respeta switch de failsafe desactivado (llm_failsafe_enabled = false)', async () => {
    jest.spyOn(configuracionRepo, 'get').mockImplementation(async (key) => {
      if (key === 'llm_provider') return 'gemini';
      if (key === 'llm_model') return 'gemini-1.5-flash';
      if (key === 'llm_api_key') return 'mock_gemini_key';
      if (key === 'llm_failsafe_enabled') return 'false'; // DESACTIVADO
      if (key === 'llm_fallback_provider') return 'openai';
      if (key === 'llm_fallback_model') return 'gpt-4o-mini';
      return null;
    });

    const mockPost = jest.fn().mockRejectedValue(new Error('Gemini API Error 503'));
    axios.post.mockImplementation(mockPost);

    const res = await llmService.generateWithTools(
      'Instrucción',
      [{ role: 'user', content: 'Hola' }],
      {}
    );

    // Only 1 call attempted, fallback was skipped
    expect(mockPost).toHaveBeenCalledTimes(1);
    // Returns graceful local heuristic greeting
    expect(res.reply).toContain('Bienvenido a Kroser');
  });

  test('5. Fail-Safe en modo generateResponse simple', async () => {
    jest.spyOn(configuracionRepo, 'get').mockImplementation(async (key) => {
      if (key === 'llm_provider') return 'gemini';
      if (key === 'llm_model') return 'gemini-1.5-pro';
      if (key === 'llm_api_key') return 'mock_gemini_key';
      if (key === 'llm_failsafe_enabled') return 'true';
      if (key === 'llm_fallback_provider') return 'openai';
      if (key === 'llm_fallback_model') return 'gpt-4o-mini';
      if (key === 'llm_fallback_api_key') return 'mock_openai_key';
      return null;
    });

    const mockPost = jest.fn()
      .mockRejectedValueOnce(new Error('Gemini Timeout'))
      .mockResolvedValueOnce({
        data: {
          choices: [
            {
              message: {
                content: 'Respuesta OpenAI fallback en single-turn',
              },
            },
          ],
        },
      });
    axios.post.mockImplementation(mockPost);

    const reply = await llmService.generateResponse(
      'Instrucción',
      [{ role: 'user', content: 'Consulta rápida' }],
      {}
    );

    expect(reply).toContain('Respuesta OpenAI fallback en single-turn');
    expect(mockPost).toHaveBeenCalledTimes(2);
  });
});
