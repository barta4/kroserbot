jest.mock('../services/search/queryClassifier', () => ({
  classifyQuery: jest.fn().mockResolvedValue(null),
}));

const axios = require('axios');
const channelPolicy = require('../services/channel/channelPolicy');
const toolExecutor = require('../services/webhook/toolExecutor');
const searchService = require('../services/search/searchService');
const configuracionRepo = require('../repositories/configuracionRepository');
const llmService = require('../services/llm/llmService');

describe('WhatsApp: respuesta acotada y fallback fijo', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('búsqueda vacía en WhatsApp devuelve teléfono/dirección fijos', async () => {
    jest.spyOn(searchService, 'hybridSearch').mockResolvedValue([]);
    jest.spyOn(configuracionRepo, 'get').mockResolvedValue(null);

    const res = await toolExecutor.executeTool(
      'buscar_productos',
      { consulta: 'producto inexistente xyz' },
      { channel: 'Channel::Whatsapp', channelPolicy: channelPolicy.WHATSAPP }
    );

    expect(res.productos).toEqual([]);
    expect(res.total_coincidencias).toBe(0);
    expect(res.respuesta_cerrada).toContain('Av. 8 de Octubre 3452');
    expect(res.respuesta_cerrada).toContain('2508 3100');
    expect(res.directiva_vendedor).toContain('WHATSAPP');
    expect(res.directiva_vendedor).toContain('PROHIBIDO ofrecer productos similares');
  });

  test('web mantiene la directiva anterior y no usa respuesta cerrada', async () => {
    jest.spyOn(searchService, 'hybridSearch').mockResolvedValue([]);
    jest.spyOn(configuracionRepo, 'get').mockResolvedValue(null);

    const res = await toolExecutor.executeTool(
      'buscar_productos',
      { consulta: 'producto inexistente xyz' },
      { channel: 'Channel::WebWidget' }
    );

    expect(res.productos).toEqual([]);
    expect(res.respuesta_cerrada).toBeUndefined();
    expect(res.directiva_vendedor).toContain('NO se encontraron artículos coincidentes');
  });

  test('getDeterministicToolReply sólo aplica a WhatsApp', async () => {
    jest.spyOn(configuracionRepo, 'get').mockResolvedValue(null);
    const toolsUsed = [
      { name: 'buscar_productos', result: { productos: [], respuesta_cerrada: 'Hola, no tenemos. Llamá al 2508 3100.' } },
    ];

    const wa = await toolExecutor.getDeterministicToolReply(toolsUsed, {
      channelPolicy: channelPolicy.WHATSAPP,
    });
    expect(wa).toContain('2508 3100');

    const web = await toolExecutor.getDeterministicToolReply(toolsUsed, {
      channelPolicy: channelPolicy.STANDARD,
    });
    expect(web).toBeNull();
  });

  test('llmService evita la segunda ronda del LLM en WhatsApp con búsqueda vacía', async () => {
    jest.spyOn(configuracionRepo, 'get').mockImplementation(async (key) => {
      if (key === 'llm_provider') return 'openai';
      if (key === 'llm_model') return 'gpt-4o-mini';
      if (key === 'llm_api_key') return 'sk-test-key';
      if (key === 'llm_fallback_provider') return 'gemini';
      if (key === 'llm_fallback_api_key') return '';
      return null;
    });
    jest.spyOn(toolExecutor, 'executeTool').mockResolvedValue({
      productos: [],
      total_coincidencias: 0,
      respuesta_cerrada: 'Hola, no tenemos ese artículo. Consultá en Av. 8 de Octubre 3452 o llamá al 2508 3100.',
    });

    const postSpy = jest.spyOn(axios, 'post').mockResolvedValueOnce({
      data: {
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'buscar_productos', arguments: '{"consulta":"producto inexistente"}' },
                },
              ],
            },
          },
        ],
      },
    });

    const res = await llmService.generateWithTools(
      'Instrucción',
      [{ role: 'user', content: 'busco producto inexistente' }],
      { toolContext: { channel: 'whatsapp', channelPolicy: channelPolicy.WHATSAPP } }
    );

    expect(res.reply).toContain('Av. 8 de Octubre 3452');
    expect(res.reply).toContain('2508 3100');
    expect(postSpy).toHaveBeenCalledTimes(1);
  });
});
