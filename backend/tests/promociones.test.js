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

const db = require('../config/db');
const promocionesRepo = require('../repositories/promocionesRepository');
const promocionesRoutes = require('../routes/promocionesRoutes');

// Mock requireAuth and requireRole
jest.mock('../middleware/requireAuth', () => ({
  requireAuth: (req, res, next) => {
    req.user = { id: 1, role: 'admin' };
    next();
  },
  requireRole: () => (req, res, next) => next(),
}));

describe('Promociones Especiales y Banners Dinámicos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Verificación de Migración SQL', () => {
    test('La migración de promociones especiales contiene tabla, índices y seeds', () => {
      const migPath = path.join(__dirname, '../../db/migrations/1786215100000_promociones_especiales.sql');
      expect(fs.existsSync(migPath)).toBe(true);

      const sql = fs.readFileSync(migPath, 'utf8');
      expect(sql).toContain('CREATE TABLE IF NOT EXISTS promociones_especiales');
      expect(sql).toContain('titulo VARCHAR(255) NOT NULL');
      expect(sql).toContain('badge VARCHAR(100)');
      expect(sql).toContain('descuento_porcentaje NUMERIC(5,2)');
      expect(sql).toContain('link_accion VARCHAR(255)');
      expect(sql).toContain('gradiente VARCHAR(50)');
      expect(sql).toContain('texto_boton VARCHAR(100)');
      expect(sql).toContain('activo BOOLEAN DEFAULT TRUE');
      expect(sql).toContain('idx_promociones_activo_orden');
      expect(sql).toContain('Super Oferta Equus');
      expect(sql).toContain('Combo Pinturas');
    });
  });

  describe('2. Repositorio promocionesRepository', () => {
    test('getAllActive retorna promociones con activo = true ordenadas', async () => {
      const mockPromos = [
        { id: 1, titulo: 'Promo 1', activo: true, orden: 1 },
        { id: 2, titulo: 'Promo 2', activo: true, orden: 2 },
      ];
      db.query.mockResolvedValueOnce({ rows: mockPromos });

      const result = await promocionesRepo.getAllActive();
      expect(result).toEqual(mockPromos);
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('WHERE activo = true'));
    });

    test('create inserta correctamente una promoción con valores por defecto', async () => {
      const mockCreated = {
        id: 10,
        titulo: 'Promo Test',
        subtitulo: 'Subtitulo Test',
        badge: 'OFERTA ESPECIAL',
        descuento_porcentaje: 20,
        link_accion: 'Equus',
        imagen_url: '',
        gradiente: 'amber',
        texto_boton: 'Ver Oferta',
        activo: true,
        orden: 1,
      };
      db.query.mockResolvedValueOnce({ rows: [mockCreated] });

      const created = await promocionesRepo.create({
        titulo: 'Promo Test',
        subtitulo: 'Subtitulo Test',
        descuento_porcentaje: 20,
        link_accion: 'Equus',
      });

      expect(created).toEqual(mockCreated);
      expect(db.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO promociones_especiales'),
        expect.arrayContaining(['Promo Test', 'Subtitulo Test', 'OFERTA ESPECIAL', 20, 'Equus'])
      );
    });

    test('toggle invierte el estado activo de la promoción', async () => {
      const mockToggled = { id: 1, titulo: 'Promo 1', activo: false };
      db.query.mockResolvedValueOnce({ rows: [mockToggled] });

      const res = await promocionesRepo.toggle(1);
      expect(res.activo).toBe(false);
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('SET activo = NOT activo'), [1]);
    });

    test('delete elimina la promoción y devuelve la fila borrada', async () => {
      const mockDeleted = { id: 1, titulo: 'Promo Borrada' };
      db.query.mockResolvedValueOnce({ rows: [mockDeleted] });

      const res = await promocionesRepo.delete(1);
      expect(res).toEqual(mockDeleted);
      expect(db.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM promociones_especiales'), [1]);
    });
  });

  describe('3. Endpoints REST (/api/promociones)', () => {
    let app;

    beforeAll(() => {
      app = express();
      app.use(express.json());
      app.use('/api/promociones', promocionesRoutes);
    });

    test('GET /api/promociones devuelve lista de promociones activas (Público)', async () => {
      const mockPromos = [
        { id: 1, titulo: 'Oferta Escaleras Equus', badge: '⚡ EQUUS', activo: true },
      ];
      db.query.mockResolvedValueOnce({ rows: mockPromos });

      const res = await request(app).get('/api/promociones');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.total).toBe(1);
      expect(res.body.promociones[0].titulo).toBe('Oferta Escaleras Equus');
    });

    test('POST /api/promociones rechaza petición sin título', async () => {
      const res = await request(app)
        .post('/api/promociones')
        .send({ subtitulo: 'Sin titulo' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('título');
    });

    test('POST /api/promociones crea promoción válida con éxito', async () => {
      const newPromo = {
        id: 5,
        titulo: 'Nueva Promo Creada',
        badge: 'OFERTA',
        descuento_porcentaje: 15,
        activo: true,
      };
      db.query.mockResolvedValueOnce({ rows: [newPromo] });

      const res = await request(app)
        .post('/api/promociones')
        .send({
          titulo: 'Nueva Promo Creada',
          badge: 'OFERTA',
          descuento_porcentaje: 15,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.promocion.titulo).toBe('Nueva Promo Creada');
    });

    test('PATCH /api/promociones/:id/toggle alterna el estado activo', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: 5, titulo: 'Promo', activo: false }],
      });

      const res = await request(app).patch('/api/promociones/5/toggle');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.promocion.activo).toBe(false);
    });

    test('DELETE /api/promociones/:id elimina la promoción existente', async () => {
      db.query.mockResolvedValueOnce({
        rows: [{ id: 5, titulo: 'Promo a eliminar' }],
      });

      const res = await request(app).delete('/api/promociones/5');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('eliminada con éxito');
    });
  });
});
