const db = require('../config/db');
const redis = require('../config/redis');
const generateEmbeddingsService = require('../services/embeddings/generateEmbeddings');
const embeddingProvider = require('../services/embeddings/embeddingProvider');
const scraperController = require('../controllers/scraperController');

describe('Embeddings Management & Dashboard Endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. embeddingProvider info & dimensions', () => {
    test('getActiveProviderInfo retorna dimensiones 768 y modelo correspondiente', async () => {
      const info = await embeddingProvider.getActiveProviderInfo();
      expect(info.dimensions).toBe(768);
      expect(info.modelGemini).toContain('text-embedding-004');
      expect(info.modelOpenAI).toContain('768');
    });
  });

  describe('2. generateEmbeddings.getEmbeddingsStatus', () => {
    test('Calcula porcentajes y estructura de métricas correctamente', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [
          {
            total_activos: '100',
            vectorizados: '80',
            pendientes: '20',
          },
        ],
      });
      jest.spyOn(redis, 'get').mockResolvedValueOnce(null);

      const status = await generateEmbeddingsService.getEmbeddingsStatus();

      expect(status.total_activos).toBe(100);
      expect(status.vectorizados).toBe(80);
      expect(status.pendientes).toBe(20);
      expect(status.porcentaje_completado).toBe(80);
      expect(status.is_running).toBe(false);
      expect(status.provider).toBeDefined();
      expect(status.provider.dimensions).toBe(768);
    });
  });

  describe('3. scraperController embeddings handlers', () => {
    test('getEmbeddingsStatus responde status en formato JSON', async () => {
      jest.spyOn(db, 'query').mockResolvedValueOnce({
        rows: [
          {
            total_activos: '50',
            vectorizados: '50',
            pendientes: '0',
          },
        ],
      });

      const req = {};
      const res = {
        json: jest.fn(),
      };
      const next = jest.fn();

      await scraperController.getEmbeddingsStatus(req, res, next);

      expect(res.json).toHaveBeenCalled();
      const payload = res.json.mock.calls[0][0];
      expect(payload.total_activos).toBe(50);
      expect(payload.porcentaje_completado).toBe(100);
    });

    test('triggerEmbeddingsGeneration responde 202 si hay pendientes', async () => {
      jest.spyOn(generateEmbeddingsService, 'getEmbeddingsStatus').mockResolvedValueOnce({
        total_activos: 100,
        vectorizados: 80,
        pendientes: 20,
        is_running: false,
      });
      const processSpy = jest
        .spyOn(generateEmbeddingsService, 'processIncrementalEmbeddings')
        .mockImplementation(() => Promise.resolve({ processed: 20 }));

      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await scraperController.triggerEmbeddingsGeneration(req, res, next);

      // Allow setImmediate to resolve cleanly before test teardown
      await new Promise((resolve) => setImmediate(resolve));

      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('iniciada en segundo plano'),
          pendientes: 20,
        })
      );
      expect(processSpy).toHaveBeenCalled();
    });

    test('triggerEmbeddingsGeneration rechaza con 409 si ya está en ejecución', async () => {
      jest.spyOn(generateEmbeddingsService, 'getEmbeddingsStatus').mockResolvedValueOnce({
        total_activos: 100,
        vectorizados: 80,
        pendientes: 20,
        is_running: true,
      });

      const req = {};
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await scraperController.triggerEmbeddingsGeneration(req, res, next);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Ya hay un proceso'),
        })
      );
    });
  });
});
