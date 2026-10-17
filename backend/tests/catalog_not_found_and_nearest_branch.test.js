/**
 * Test Suite: Catalog Not Found & Nearest Branch Flow
 *
 * Verifies that:
 * 1. Queries for items not in catalog ("varilla de 16", "varilla redonda de hierro")
 *    do NOT return spurious unrelated items (paint trays, O-rings, spoons, cortahierros).
 * 2. Empty search directive instructs: "Hola, no tenemos en el catálogo. Si desea, páseme su ubicación y le envío datos de la sucursal más cercana."
 * 3. Exactly 1 single message is dispatched to the client (WhatsApp / Meta cost optimization).
 * 4. Location inquiry returns nearest branch in 1 concise single message.
 */

const axios = require('axios');
const { rerank } = require('../services/search/reranker');
const { executeTool } = require('../services/webhook/toolExecutor');
const llmService = require('../services/llm/llmService');
const webhookService = require('../services/webhook/webhookService');
const chatwootService = require('../services/chatwoot/chatwootService');
const configuracionRepo = require('../repositories/configuracionRepository');
const conversacionesRepo = require('../repositories/conversacionesRepository');
const redis = require('../config/redis');

describe('Flujo: Producto No Encontrado -> Cero Similares -> Pedir Ubicación -> Sucursal Cercana', () => {
  const testConvId = 998877;

  beforeEach(async () => {
    await redis.del(`conv_memory:${testConvId}`);
    await redis.del(`conv_buffer:${testConvId}`);
    await redis.del(`human_active:${testConvId}`);
    jest.clearAllMocks();
  });

  describe('1. Re-ranker and Precision: Eliminación de falsos positivos', () => {
    test('Descarta artículos espurios cuando el sustantivo núcleo (varilla) no coincide', () => {
      const unrelatedCandidates = [
        {
          sku: '86620165',
          nombre: 'BANDEJA DE PINTURA DE 320 X 160 X 60 MM HARDEN ++',
          categoria: 'Pintura',
          stock_status: 'in_stock',
          precio: '1.41',
        },
        {
          sku: '86625205',
          nombre: 'O RING 16 PZAS DE 25 X 3.5 MM HARDEN ++',
          categoria: 'Ferreteria',
          stock_status: 'in_stock',
          precio: '1.42',
        },
        {
          sku: '86620175',
          nombre: 'REPUESTO RODILLO POLIESTER 16MM DE 9 HARDEN ++',
          categoria: 'Pintura',
          stock_status: 'in_stock',
          precio: '1.63',
        },
        {
          sku: '86613016',
          nombre: 'MECHA PALETA MADERA 16MM PRO HARDEN ++',
          categoria: 'Herramientas',
          stock_status: 'in_stock',
          precio: '1.87',
        },
      ];

      const ranked = rerank(unrelatedCandidates, 'varilla de 16', {});
      // Todos los ítems deben tener penalización o score <= 0 y quedar descartados
      for (const item of ranked) {
        expect(item._score).toBeLessThanOrEqual(0);
      }
    });

    test('Descarta cucharas de albañil o cortahierros ante "varilla redonda de hierro"', () => {
      const candidates = [
        {
          sku: '86620226',
          nombre: 'CUCHARA ALBAÑIL 6 PUNTA REDONDA PRO HARDEN ++',
          categoria: 'Herramientas',
          stock_status: 'in_stock',
          precio: '3.46',
        },
        {
          sku: '82016306',
          nombre: 'CORTAHIERROS STANLEY CRV 1/4 X 13CM',
          categoria: 'Herramientas',
          stock_status: 'in_stock',
          precio: '257',
        },
      ];

      const ranked = rerank(candidates, 'varilla redonda de hierro', {});
      for (const item of ranked) {
        expect(item._score).toBeLessThanOrEqual(0);
      }
    });
  });

  describe('2. Tool Executor: Directiva obligatoria de producto no encontrado', () => {
    test('executeBuscarProductos con consulta inexistente retorna lista vacía y directiva de ubicación', async () => {
      const res = await executeTool('buscar_productos', { consulta: 'varilla de 16' });
      expect(res.productos).toEqual([]);
      expect(res.total_coincidencias).toBe(0);
      expect(res.directiva_vendedor).toContain('NO se encontraron artículos coincidentes');
      expect(res.directiva_vendedor).toContain('Hola, no tenemos en el catálogo. Si desea, páseme su ubicación y le envío datos de la sucursal más cercana.');
    });
  });

  describe('3. LLM Service Fallback: Fórmula exacta sin resultado', () => {
    test('llmService retorna fórmula exacta de un solo mensaje si buscar_productos dio 0 resultados', async () => {
      jest.spyOn(configuracionRepo, 'get').mockImplementation(async (key) => {
        if (key === 'llm_provider') return 'openai';
        if (key === 'llm_model') return 'gpt-4o-mini';
        if (key === 'llm_api_key') return 'mock_key';
        return null;
      });

      jest.spyOn(axios, 'post')
        .mockResolvedValueOnce({
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
                      function: {
                        name: 'buscar_productos',
                        arguments: JSON.stringify({ consulta: 'varilla de 16' }),
                      },
                    },
                  ],
                },
              },
            ],
          },
        })
        .mockRejectedValueOnce(new Error('Round 2 with tools timeout to test heuristic fallback'))
        .mockRejectedValueOnce(new Error('Round 2 without tools timeout to test heuristic fallback'));

      const res = await llmService.generateWithTools('Instrucción', [{ role: 'user', content: 'Consulta varilla de 16 tienen ?' }], {});

      expect(res.reply).toContain('no tenemos en el catálogo');
      expect(res.reply).toContain('sucursal más cercana');
      expect(res.toolsUsed.length).toBeGreaterThan(0);
      expect(res.toolsUsed[0].name).toBe('buscar_productos');
    });

    test('llmService retorna sucursal cercana exacta cuando se ejecuta buscar_sucursales', async () => {
      jest.spyOn(configuracionRepo, 'get').mockImplementation(async (key) => {
        if (key === 'llm_provider') return 'openai';
        if (key === 'llm_model') return 'gpt-4o-mini';
        if (key === 'llm_api_key') return 'mock_key';
        return null;
      });

      jest.spyOn(axios, 'post')
        .mockResolvedValueOnce({
          data: {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_2',
                      type: 'function',
                      function: {
                        name: 'buscar_sucursales',
                        arguments: JSON.stringify({ zona: 'Pocitos' }),
                      },
                    },
                  ],
                },
              },
            ],
          },
        })
        .mockRejectedValueOnce(new Error('Round 2 with tools timeout to test heuristic fallback'))
        .mockRejectedValueOnce(new Error('Round 2 without tools timeout to test heuristic fallback'));

      const localesRepo = require('../repositories/localesRepository');
      jest.spyOn(localesRepo, 'search').mockResolvedValue([
        {
          nombre: 'Pocitos',
          zona: 'Pocitos',
          direccion: 'Av. Brasil 2500',
          telefono: '2708 0000',
        },
      ]);

      const res = await llmService.generateWithTools('Instrucción', [{ role: 'user', content: 'Estoy en Pocitos' }], {});

      expect(res.reply).toContain('sucursal más cercana');
      expect(res.reply).toContain('Kroser');
      expect(res.toolsUsed[0].name).toBe('buscar_sucursales');
    });
  });

  describe('4. Webhook End-to-End: Optimización 1 solo mensaje WhatsApp', () => {
    test('Procesa consulta de producto inexistente y envía EXACTAMENTE 1 mensaje por WhatsApp', async () => {
      const sendSpy = jest.spyOn(chatwootService, 'sendMessage').mockResolvedValue({ success: true, id: 1001 });
      jest.spyOn(conversacionesRepo, 'logMessage').mockResolvedValue({});
      jest.spyOn(chatwootService, 'toggleTypingStatus').mockResolvedValue({ success: true });

      // Mock LLM resolving to the exact formula
      jest.spyOn(llmService, 'generateWithTools').mockResolvedValue({
        reply: 'Hola, no tenemos en el catálogo. Si desea, páseme su ubicación y le envío datos de la sucursal más cercana.',
        toolsUsed: [{ name: 'buscar_productos', args: { consulta: 'varilla de 16' }, result: { productos: [] } }],
        createdOrder: null,
      });

      const payload = {
        event: 'message_created',
        message_type: 'incoming',
        content: 'Consulta varilla de 16 tienen ?',
        conversation: { id: testConvId, channel: 'whatsapp' },
        sender: { id: 77, name: 'Ignacio' },
        account: { id: 1 },
      };

      const result = await webhookService.processWebhookEvent(payload);

      expect(result.status).toBe('processed');
      expect(result.chunks).toBeDefined();
      expect(result.chunks).toHaveLength(1);

      // Verificación de costo Meta: exactamente 1 envío
      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy).toHaveBeenCalledWith(
        1,
        testConvId,
        'Hola, no tenemos en el catálogo. Si desea, páseme su ubicación y le envío datos de la sucursal más cercana.'
      );

      sendSpy.mockRestore();
    });
  });
});
