const fs = require('fs');
const path = require('path');
const request = require('supertest');
const express = require('express');

// Mock dependencies
jest.mock('../config/db', () => ({
  query: jest.fn(),
}));

jest.mock('../config/redis', () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(),
  publish: jest.fn(),
  on: jest.fn(),
}));

jest.mock('../services/embeddings/generateEmbeddings', () => ({
  processIncrementalEmbeddings: jest.fn().mockResolvedValue({ processed: 0 }),
}));

const db = require('../config/db');
const pricingCalculator = require('../utils/pricingCalculator');
const proveedoresRepo = require('../repositories/proveedoresScraperRepository');
const multiScraperSyncService = require('../services/scraper/multiScraperSyncService');
const proveedoresRoutes = require('../routes/proveedoresScraperRoutes');

// Mock auth middleware so test can run without login
jest.mock('../middleware/requireAuth', () => ({
  requireAuth: (req, res, next) => {
    req.user = { id: 1, role: 'admin' };
    next();
  },
  requireRole: () => (req, res, next) => next(),
}));

describe('Multi-Scraper & Proveedores (Equus + 4 Sitios Adicionales)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Verificación de Migración SQL', () => {
    test('La migración multi-scraper contiene tabla, seeds de Equus + 4 sitios y columnas en productos', () => {
      const migPath = path.join(__dirname, '../../db/migrations/1786215000000_multi_scrapers_and_proveedores.sql');
      expect(fs.existsSync(migPath)).toBe(true);

      const sql = fs.readFileSync(migPath, 'utf8');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS proveedores_scraper');
      expect(sql).toContain('equus');
      expect(sql).toContain('sitio_2');
      expect(sql).toContain('sitio_3');
      expect(sql).toContain('sitio_4');
      expect(sql).toContain('sitio_5');
      expect(sql).toContain('precio_costo NUMERIC(10,2)');
      expect(sql).toContain('fuente_origen VARCHAR(50)');
      expect(sql).toContain('margen_aplicado NUMERIC(5,2)');
      expect(sql).toContain('iva_aplicado NUMERIC(5,2)');
      expect(sql).toContain('idx_productos_fuente_origen');
    });
  });

  describe('2. Motor de Precios: calculateSellingPrice', () => {
    test('Calcula precio de venta con margen cuando el costo ya incluye IVA', () => {
      // Costo $1000, margen 35%, costo ya incluye IVA
      const res = pricingCalculator.calculateSellingPrice(1000, {
        margenPorcentaje: 35.0,
        costoIncluyeIva: true,
        aplicarIvaVenta: false,
      });

      expect(res.precio_costo).toBe(1000);
      expect(res.precio_venta).toBe(1350); // 1000 * 1.35
      expect(res.margen_porcentaje).toBe(35);
      expect(res.iva_porcentaje).toBe(0);
      expect(res.iva_monto).toBe(0);
    });

    test('Calcula precio con margen y agrega 22% de IVA si el costo es neto', () => {
      // Costo $1000, margen 30%, neto -> aplica 22% IVA
      // Subtotal con margen: 1300. Precio final: 1300 * 1.22 = 1586
      const res = pricingCalculator.calculateSellingPrice(1000, {
        margenPorcentaje: 30.0,
        costoIncluyeIva: false,
        aplicarIvaVenta: true,
      });

      expect(res.precio_costo).toBe(1000);
      expect(res.subtotal).toBe(1300);
      expect(res.precio_venta).toBe(1586);
      expect(res.iva_monto).toBe(286);
      expect(res.iva_porcentaje).toBe(22);
    });

    test('Maneja costos inválidos o cero retornando 0 de forma segura', () => {
      const res = pricingCalculator.calculateSellingPrice(0);
      expect(res.precio_venta).toBe(0);
      expect(res.precio_costo).toBe(0);

      const resNull = pricingCalculator.calculateSellingPrice(null);
      expect(resNull.precio_venta).toBe(0);
    });
  });

  describe('3. Repositorio de Proveedores de Scraper', () => {
    test('getAll retorna listado con conteos de productos', async () => {
      const mockRows = [
        { id: 1, codigo: 'equus', nombre: 'Equus Uruguay', activo: true, total_productos_activos: 15 },
        { id: 2, codigo: 'sitio_2', nombre: 'Proveedor 2', activo: false, total_productos_activos: 0 },
      ];
      db.query.mockResolvedValueOnce({ rows: mockRows });

      const res = await proveedoresRepo.getAll();
      expect(res).toEqual(mockRows);
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('FROM proveedores_scraper'));
    });

    test('getByCodigo busca proveedor por código', async () => {
      const mockRow = { id: 1, codigo: 'equus', margen_porcentaje: 35.0 };
      db.query.mockResolvedValueOnce({ rows: [mockRow] });

      const res = await proveedoresRepo.getByCodigo('equus');
      expect(res).toEqual(mockRow);
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE codigo = $1'), ['equus']);
    });

    test('recalcularPrecios actualiza masivamente los precios en productos', async () => {
      // 1. Mock getByCodigo
      db.query.mockResolvedValueOnce({
        rows: [{ codigo: 'equus', nombre: 'Equus', margen_porcentaje: 40.0, costo_incluye_iva: true, aplicar_iva_venta: false }],
      });
      // 2. Mock UPDATE query
      db.query.mockResolvedValueOnce({ rowCount: 42 });

      const res = await proveedoresRepo.recalcularPrecios('equus');
      expect(res.codigo).toBe('equus');
      expect(res.margen_aplicado).toBe(40);
      expect(res.productos_actualizados).toBe(42);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE productos'),
        [40, 'equus']
      );
    });
  });

  describe('4. Sincronización Multi-Scraper (multiScraperSyncService)', () => {
    test('Normaliza SKU con prefijo EQ- e inserta productos con cálculo de margen', async () => {
      // Mock proveedor equus
      db.query.mockResolvedValueOnce({
        rows: [{
          codigo: 'equus',
          nombre: 'Equus Uruguay',
          prefijo_sku: 'EQ-',
          margen_porcentaje: 30.0,
          costo_incluye_iva: true,
          aplicar_iva_venta: false,
          moneda_defecto: 'UYU',
        }],
      });

      // Mock INSERT query
      db.query.mockResolvedValueOnce({ rows: [{ is_inserted: true }] });

      const rawProducts = [
        {
          sku: 'R16005',
          nombre: 'Escalera 5 Escalones',
          price: { amount: 1000, currency: 'UYU' },
          availability: 'in_stock',
        },
      ];

      const res = await multiScraperSyncService.syncProducts('equus', rawProducts);
      expect(res.total).toBe(1);
      expect(res.inserted).toBe(1);

      // Verify SKU prefixed with EQ- and price calculated with 30% margin ($1300)
      const lastCallArgs = db.query.mock.calls[1][1];
      expect(lastCallArgs[0]).toBe('EQ-R16005'); // SKU final
      expect(lastCallArgs[1]).toBe('Escalera 5 Escalones'); // Nombre
      expect(lastCallArgs[2]).toBe(1300); // Precio venta final (1000 + 30%)
      expect(lastCallArgs[3]).toBe(1000); // Precio costo original
      expect(lastCallArgs[11]).toBe('equus'); // Fuente origen
    });
  });

  describe('5. Endpoints REST (/api/proveedores-scraper)', () => {
    let app;

    beforeAll(() => {
      app = express();
      app.use(express.json());
      app.use('/api/proveedores-scraper', proveedoresRoutes);
    });

    test('GET /api/proveedores-scraper retorna listado de proveedores', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ codigo: 'equus', nombre: 'Equus Uruguay', activo: true }],
      });

      const res = await request(app).get('/api/proveedores-scraper');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.proveedores[0].codigo).toBe('equus');
    });

    test('POST /api/proveedores-scraper/:codigo/recalcular-precios ejecuta recálculo', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ codigo: 'equus', nombre: 'Equus', margen_porcentaje: 35.0, costo_incluye_iva: true, aplicar_iva_venta: false }],
      });
      db.query.mockResolvedValueOnce({ rowCount: 10 });

      const res = await request(app).post('/api/proveedores-scraper/equus/recalcular-precios');
      expect(res.status).toBe(200);
      expect(res.body.resultado.productos_actualizados).toBe(10);
    });

    test('POST /api/proveedores-scraper/:codigo/sync ingesta lote de productos', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ codigo: 'equus', prefijo_sku: 'EQ-', margen_porcentaje: 30.0, costo_incluye_iva: true, aplicar_iva_venta: false, moneda_defecto: 'UYU' }],
      });
      db.query.mockResolvedValueOnce({ rows: [{ is_inserted: true }] });

      const res = await request(app)
        .post('/api/proveedores-scraper/equus/sync')
        .send({
          products: [{ sku: 'TEST-1', nombre: 'Taladro Test', costo: 500 }],
        });

      expect(res.status).toBe(200);
      expect(res.body.resultado.inserted).toBe(1);
    });
  });
});
