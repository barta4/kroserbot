jest.mock('../config/db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

const db = require('../config/db');
const { rerank } = require('../services/search/reranker');
const productosRepo = require('../repositories/productosRepository');
const configuracionRepo = require('../repositories/configuracionRepository');
const { hybridSearch } = require('../services/search/searchService');

describe('Precisión de búsqueda', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Re-ranker', () => {
    test('encuentra productos con nombre concatenado vía sinónimo', () => {
      const product = {
        sku: 'TIJ-42',
        nombre: 'TIJERACORTATUBOSPVCDE42MMPROHARDEN++',
        categoria: 'Herramientas',
        descripcion: '',
        marca: 'Harden',
        precio: '590',
        stock_status: 'in_stock',
      };
      const ranked = rerank([product], 'cortador de caño', {
        synonyms: ['tijera corta tubo pvc'],
      });
      expect(ranked[0]._score).toBeGreaterThan(0);
    });

    test('descarta productos que no contienen el sustantivo principal', () => {
      const product = {
        sku: 'BOTA-39',
        nombre: 'BOTA DE LLUVIA PVC NEGRA CE Nº 39',
        categoria: 'Calzado',
        descripcion: '',
        marca: 'Kroser',
        precio: '900',
        stock_status: 'in_stock',
      };
      const ranked = rerank([product], 'caño pvc 1/2', { medida: '1/2' });
      expect(ranked[0]._score).toBeLessThanOrEqual(0);
    });

    test('penaliza potencia incompatible (9W no debe devolver 60W)', () => {
      const product = {
        sku: 'FOCO-60',
        nombre: 'FOCO SOLAR LED SUPER BRILLO 60W C/PANEL Y SENSOR',
        categoria: 'Iluminacion',
        descripcion: '',
        marca: 'Kroser',
        precio: '1200',
        stock_status: 'in_stock',
      };
      const ranked = rerank([product], 'foco led 9w', { potencia: '9w' });
      expect(ranked[0]._score).toBeLessThanOrEqual(0);
    });

    test('mantiene el producto cuando la potencia coincide', () => {
      const product = {
        sku: 'FOCO-9',
        nombre: 'FOCO LED 9W LUZ CALIDA',
        categoria: 'Iluminacion',
        descripcion: '',
        marca: 'Kroser',
        precio: '300',
        stock_status: 'in_stock',
      };
      const ranked = rerank([product], 'foco led 9w', { potencia: '9w' });
      expect(ranked[0]._score).toBeGreaterThan(0);
    });

    test('prioriza el producto que coincide con más sustantivos núcleo', () => {
      const latex = {
        sku: 'LATEX-20',
        nombre: 'PINTURA LATEX INTERIOR BLANCA 20L',
        categoria: 'Pintura',
        descripcion: '',
        marca: 'Inca',
        precio: '2000',
        stock_status: 'in_stock',
      };
      const piso = {
        sku: 'PISO-1',
        nombre: 'PINTURA PARA PISOS NEGRA 1L',
        categoria: 'Pintura',
        descripcion: '',
        marca: 'Inca',
        precio: '500',
        stock_status: 'in_stock',
      };
      const ranked = rerank([piso, latex], 'pintura latex blanca', {});
      expect(ranked[0].sku).toBe('LATEX-20');
    });

    test('un sinónimo parcial no alcanza para puntuar', () => {
      const cepillo = {
        sku: 'CEP-1',
        nombre: 'CEPILLO ACERO BASE PP C/MANGO 3 HILERAS',
        categoria: 'Herramientas',
        descripcion: '',
        marca: 'Truper',
        precio: '300',
        stock_status: 'in_stock',
      };
      cepillo._matchedQuery = 'base multiple';
      cepillo._matchedType = 'synonym';
      const ranked = rerank([cepillo], 'zapatilla 4 tomas', {
        synonyms: ['alargue', 'base multiple', 'prolongador'],
      });
      expect(ranked[0]._score).toBeLessThanOrEqual(0);
    });
  });

  describe('Repositorio', () => {
    test('usa krosmart_unaccent y normaliza la ñ en SQL', async () => {
      db.query.mockResolvedValue({ rows: [] });
      await productosRepo.searchByKeyword('caño', 5);
      const firstCall = db.query.mock.calls[0];
      expect(firstCall[0]).toContain('krosmart_unaccent');
      expect(firstCall[0]).not.toContain("'aeiouu'");
      expect(firstCall[1][0]).toBe('%cano%');
    });

    test('la relajación OR sólo se ejecuta cuando allowRelaxed es true', async () => {
      db.query.mockClear();
      db.query.mockResolvedValue({ rows: [] });
      await productosRepo.searchByKeyword('pintura latex blanca 20l', 5, { allowRelaxed: false });
      const strictCalls = db.query.mock.calls.length;
      expect(strictCalls).toBe(3);

      db.query.mockClear();
      db.query.mockResolvedValue({ rows: [] });
      await productosRepo.searchByKeyword('pintura latex blanca 20l', 5, { allowRelaxed: true });
      expect(db.query.mock.calls.length).toBe(strictCalls + 1);
    });
  });

  describe('SearchService', () => {
    test('WhatsApp no ejecuta la búsqueda relajada por prefijo', async () => {
      jest.spyOn(configuracionRepo, 'get').mockResolvedValue(null);
      jest.spyOn(productosRepo, 'searchByKeyword').mockResolvedValue([]);
      jest.spyOn(productosRepo, 'searchFTS').mockResolvedValue([]);
      const prefixSpy = jest.spyOn(productosRepo, 'searchByPrefix').mockResolvedValue([]);

      await hybridSearch('caño pvc 1/2', { limit: 5, skipVector: true, allowRelaxed: false });
      expect(prefixSpy).not.toHaveBeenCalled();
    });

    test('web ejecuta la búsqueda relajada por prefijo', async () => {
      jest.spyOn(configuracionRepo, 'get').mockResolvedValue(null);
      jest.spyOn(productosRepo, 'searchByKeyword').mockResolvedValue([]);
      jest.spyOn(productosRepo, 'searchFTS').mockResolvedValue([]);
      const prefixSpy = jest.spyOn(productosRepo, 'searchByPrefix').mockResolvedValue([]);

      await hybridSearch('caño pvc 1/2', { limit: 5, skipVector: true, allowRelaxed: true });
      expect(prefixSpy).toHaveBeenCalled();
    });
  });
});
