const request = require('supertest');
const app = require('../index');
const db = require('../config/db');
const categoriasRepo = require('../repositories/categoriasDescuentoRepository');
const pricingCalculator = require('../utils/pricingCalculator');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

describe('Gestión Dinámica y Manual de Categorías de Descuento (Cotibot)', () => {
  const adminToken = jwt.sign(
    { id: 1, username: 'admin', role: 'admin' },
    process.env.JWT_SECRET || 'test_jwt_secret',
    { expiresIn: '1h' }
  );

  let origDbQuery;

  beforeEach(() => {
    origDbQuery = db.query;
    jest.clearAllMocks();
  });

  afterEach(() => {
    db.query = origDbQuery;
  });

  describe('1. Repositorio categoriasDescuentoRepository', () => {
    test('getAll retorna las categorías ordenadas por orden e id', async () => {
      db.query = jest.fn().mockResolvedValueOnce({
        rows: [
          { id: 1, codigo: 'minorista', nombre: 'Minorista', descuento_porcentaje: 0.0, orden: 1, activo: true },
          { id: 2, codigo: 'profesional', nombre: 'Profesional', descuento_porcentaje: 10.0, orden: 2, activo: true },
          { id: 3, codigo: 'gremio', nombre: 'Gremio', descuento_porcentaje: 15.0, orden: 3, activo: true },
          { id: 4, codigo: 'empresa', nombre: 'Empresa', descuento_porcentaje: 20.0, orden: 4, activo: true },
        ],
      });

      const cats = await categoriasRepo.getAll();
      expect(Array.isArray(cats)).toBe(true);
      expect(cats.length).toBe(4);
      expect(cats[0].codigo).toBe('minorista');
      expect(cats[1].codigo).toBe('profesional');
    });

    test('create inserta una nueva categoría con código y porcentaje', async () => {
      db.query = jest.fn().mockResolvedValueOnce({
        rows: [{
          id: 6,
          codigo: 'arquitectos',
          nombre: 'Arquitectos y Desarrolladores',
          descuento_porcentaje: 18.5,
          orden: 7,
          activo: true,
          descripcion: 'Estudios de arquitectura',
        }],
      });

      const created = await categoriasRepo.create({
        codigo: 'arquitectos',
        nombre: 'Arquitectos y Desarrolladores',
        descuento_porcentaje: 18.5,
        orden: 7,
        descripcion: 'Estudios de arquitectura',
      });

      expect(created).toBeDefined();
      expect(created.codigo).toBe('arquitectos');
      expect(parseFloat(created.descuento_porcentaje)).toBe(18.5);
      expect(created.orden).toBe(7);
    });

    test('update actualiza descuento_porcentaje y nombre correctamente', async () => {
      db.query = jest.fn().mockResolvedValueOnce({
        rows: [{
          id: 6,
          codigo: 'arquitectos',
          nombre: 'Arquitectos VIP',
          descuento_porcentaje: 22.0,
          orden: 7,
          activo: true,
        }],
      });

      const updated = await categoriasRepo.update('arquitectos', {
        nombre: 'Arquitectos VIP',
        descuento_porcentaje: 22.0,
      });

      expect(updated).toBeDefined();
      expect(updated.nombre).toBe('Arquitectos VIP');
      expect(parseFloat(updated.descuento_porcentaje)).toBe(22.0);
    });

    test('delete desactiva si hay clientes asignados', async () => {
      // 1ra query: count clientes = 3
      // 2da query: update activo = false
      db.query = jest.fn()
        .mockResolvedValueOnce({ rows: [{ total: '3' }] })
        .mockResolvedValueOnce({ rowCount: 1 });

      const res = await categoriasRepo.delete('profesional');
      expect(res.deleted).toBe(false);
      expect(res.deactivated).toBe(true);
    });

    test('delete elimina físicamente si no tiene clientes asignados', async () => {
      // 1ra query: count clientes = 0
      // 2da query: delete
      db.query = jest.fn()
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rowCount: 1 });

      const res = await categoriasRepo.delete('categoria_sin_uso');
      expect(res.deleted).toBe(true);
      expect(res.deactivated).toBe(false);
    });

    test('getDiscountsMap construye un diccionario de porcentajes', async () => {
      db.query = jest.fn().mockResolvedValueOnce({
        rows: [
          { codigo: 'minorista', descuento_porcentaje: 0.0 },
          { codigo: 'profesional', descuento_porcentaje: 12.0 },
          { codigo: 'arquitectos', descuento_porcentaje: 18.0 },
        ],
      });

      const map = await categoriasRepo.getDiscountsMap();
      expect(map.minorista).toBe(0.0);
      expect(map.profesional).toBe(12.0);
      expect(map.arquitectos).toBe(18.0);
    });
  });

  describe('2. API REST (/api/clientes/categorias)', () => {
    test('GET /api/clientes/categorias responde 200 con la lista de categorías', async () => {
      db.query = jest.fn().mockResolvedValueOnce({
        rows: [
          { id: 1, codigo: 'minorista', nombre: 'Minorista', descuento_porcentaje: 0.0, activo: true },
          { id: 6, codigo: 'arquitectos', nombre: 'Arquitectos', descuento_porcentaje: 18.0, activo: true },
        ],
      });

      const res = await request(app).get('/api/clientes/categorias');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.categorias)).toBe(true);
      expect(res.body.categorias.length).toBe(2);
    });

    test('POST /api/clientes/categorias crea una categoría nueva con autenticación de admin', async () => {
      db.query = jest.fn()
        .mockResolvedValueOnce({ rows: [] }) // getByCodigo -> no existe
        .mockResolvedValueOnce({ // insert
          rows: [{
            id: 8,
            codigo: 'sanitarios',
            nombre: 'Sanitarios y Plomeros',
            descuento_porcentaje: 12.0,
            orden: 8,
            activo: true,
          }],
        });

      const res = await request(app)
        .post('/api/clientes/categorias')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          codigo: 'sanitarios',
          nombre: 'Sanitarios y Plomeros',
          descuento_porcentaje: 12.0,
          orden: 8,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.categoria.codigo).toBe('sanitarios');
    });

    test('POST /api/clientes/categorias rechaza duplicados con 409', async () => {
      db.query = jest.fn().mockResolvedValueOnce({
        rows: [{ id: 8, codigo: 'sanitarios', nombre: 'Sanitarios' }],
      });

      const res = await request(app)
        .post('/api/clientes/categorias')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          codigo: 'sanitarios',
          nombre: 'Sanitarios Duplicados',
          descuento_porcentaje: 15.0,
        });

      expect(res.status).toBe(409);
    });

    test('PUT /api/clientes/categorias/:codigo actualiza el porcentaje de descuento', async () => {
      db.query = jest.fn().mockResolvedValueOnce({
        rows: [{
          id: 8,
          codigo: 'sanitarios',
          nombre: 'Sanitarios Pro',
          descuento_porcentaje: 14.5,
          activo: true,
        }],
      });

      const res = await request(app)
        .put('/api/clientes/categorias/sanitarios')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          descuento_porcentaje: 14.5,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(parseFloat(res.body.categoria.descuento_porcentaje)).toBe(14.5);
    });

    test('DELETE /api/clientes/categorias/:codigo responde éxito al eliminar', async () => {
      db.query = jest.fn()
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rowCount: 1 });

      const res = await request(app)
        .delete('/api/clientes/categorias/sanitarios')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.deleted).toBe(true);
    });
  });

  describe('3. Integración con pricingCalculator', () => {
    test('calcula correctamente precios con categorías dinámicas personalizadas', () => {
      const demoProd = { id: 1, sku: 'TEST-1', precio: 1000, moneda: 'UYU' };

      // Se inyecta el mapa dinámico
      pricingCalculator.setDynamicCategoryDiscounts({
        arquitectos: 18.0,
      });

      const res = pricingCalculator.calculateProductPrice(demoProd, { categoria: 'arquitectos' });
      expect(res.precio_final).toBe(820);
      expect(res.descuento_porcentaje).toBe(18.0);
      expect(res.ahorro_monto).toBe(180);
    });
  });

  describe('4. Auditoría de interfaz en admin/index.html', () => {
    test('El panel de administración contiene la tabla y modal de gestión de categorías', () => {
      const htmlPath = path.join(__dirname, '../../admin/index.html');
      const html = fs.readFileSync(htmlPath, 'utf8');

      expect(html).toContain('id="categorias-table-body"');
      expect(html).toContain('id="categoria-modal"');
      expect(html).toContain('openNuevaCategoriaModal');
      expect(html).toContain('loadCategoriasDescuento');
      expect(html).toContain('id="clientes-filter-categoria"');
      expect(html).not.toMatch(/Chatwoot/g);
    });
  });
});
