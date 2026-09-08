const productosController = require('../controllers/productosController');
const localesController = require('../controllers/localesController');
const configuracionController = require('../controllers/configuracionController');
const pedidosService = require('../services/pedidos/pedidosService');
const pedidosRepo = require('../repositories/pedidosRepository');
const orderStateMachine = require('../services/pedidos/orderStateMachine');
const customerMemoryService = require('../services/customer/customerMemoryService');
const validateMercadopagoSignature = require('../middleware/validateMercadopagoSignature');
const db = require('../config/db');
const crypto = require('crypto');

describe('Verificación y no-regresión de Analysis Results V2', () => {

  // C1: deleteProducto
  describe('C1: productosController.deleteProducto', () => {
    test('Rechaza con 400 si el id no es un entero positivo válido', async () => {
      let status = null;
      let body = null;
      const res = {
        status(s) { status = s; return this; },
        json(b) { body = b; return this; },
      };
      const next = jest.fn();

      await productosController.deleteProducto({ params: { id: 'invalid_id' } }, res, next);
      expect(status).toBe(400);
      expect(body.error).toMatch(/inválido/i);

      await productosController.deleteProducto({ params: { id: '-5' } }, res, next);
      expect(status).toBe(400);
    });

    test('Retorna 404 si el producto no existe en DB (rowCount === 0)', async () => {
      const origQuery = db.query;
      db.query = jest.fn().mockResolvedValue({ rowCount: 0 });

      let status = null;
      let body = null;
      const res = {
        status(s) { status = s; return this; },
        json(b) { body = b; return this; },
      };
      const next = jest.fn();

      try {
        await productosController.deleteProducto({ params: { id: '99999' } }, res, next);
        expect(status).toBe(404);
        expect(body.error).toMatch(/no encontrado/i);
      } finally {
        db.query = origQuery;
      }
    });

    test('Propaga errores de DB a next(err) en vez de silenciarlos', async () => {
      const origQuery = db.query;
      const dbError = new Error('Database connection lost');
      db.query = jest.fn().mockRejectedValue(dbError);

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      try {
        await productosController.deleteProducto({ params: { id: '10' } }, res, next);
        expect(next).toHaveBeenCalledWith(dbError);
      } finally {
        db.query = origQuery;
      }
    });
  });

  // C2 & B3: localesController
  describe('C2 & B3: localesController deleteLocal and error handling', () => {
    test('deleteLocal rechaza con 400 ante id no numérico', async () => {
      let status = null;
      let body = null;
      const res = {
        status(s) { status = s; return this; },
        json(b) { body = b; return this; },
      };
      const next = jest.fn();

      await localesController.deleteLocal({ params: { id: 'abc' } }, res, next);
      expect(status).toBe(400);
      expect(body.error).toMatch(/inválido/i);
    });

    test('deleteLocal retorna 404 si no existe local', async () => {
      const origQuery = db.query;
      db.query = jest.fn().mockResolvedValue({ rowCount: 0 });

      let status = null;
      const res = {
        status(s) { status = s; return this; },
        json: jest.fn(),
      };
      const next = jest.fn();

      try {
        await localesController.deleteLocal({ params: { id: '888' } }, res, next);
        expect(status).toBe(404);
      } finally {
        db.query = origQuery;
      }
    });

    test('createLocal propaga error de base de datos a next() sin simular 201 Created falso', async () => {
      const origQuery = db.query;
      const dbError = new Error('Unique constraint violation');
      db.query = jest.fn().mockRejectedValue(dbError);

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      try {
        await localesController.createLocal({
          body: {
            nombre: 'Local Test',
            zona: 'Centro',
            direccion: 'Calle Falsa 123',
          },
        }, res, next);

        expect(next).toHaveBeenCalledWith(dbError);
        expect(res.status).not.toHaveBeenCalledWith(201);
      } finally {
        db.query = origQuery;
      }
    });
  });

  // C3: State machine enforcement in updateOrderFull
  describe('C3: Máquina de estados en actualización completa de pedidos', () => {
    test('Rechaza transiciones de estado ilegales con statusCode 400', async () => {
      const origGetById = pedidosRepo.getById;
      pedidosRepo.getById = jest.fn().mockResolvedValue({
        id: 101,
        estado: 'entregado',
      });

      try {
        await expect(
          pedidosService.updateOrderFull(101, { estado: 'pendiente' })
        ).rejects.toMatchObject({
          message: expect.stringMatching(/Transición de estado inválida/),
          statusCode: 400,
        });
      } finally {
        pedidosRepo.getById = origGetById;
      }
    });

    test('Permite transiciones de estado legales', async () => {
      const origGetById = pedidosRepo.getById;
      const origUpdateFull = pedidosRepo.updateFull;

      pedidosRepo.getById = jest.fn().mockResolvedValue({
        id: 102,
        estado: 'pendiente',
      });
      pedidosRepo.updateFull = jest.fn().mockResolvedValue({
        id: 102,
        estado: 'confirmado',
      });

      try {
        const res = await pedidosService.updateOrderFull(102, { estado: 'confirmado' });
        expect(res.estado).toBe('confirmado');
        expect(pedidosRepo.updateFull).toHaveBeenCalled();
      } finally {
        pedidosRepo.getById = origGetById;
        pedidosRepo.updateFull = origUpdateFull;
      }
    });
  });

  // A5: MercadoPago signature timingSafeEqual
  describe('A5: MercadoPago HMAC timingSafeEqual validation', () => {
    test('Rechaza firmas HMAC alteradas con 401', async () => {
      process.env.MERCADOPAGO_WEBHOOK_SECRET = 'test_secret_key_123';
      const ts = Math.floor(Date.now() / 1000);
      const req = {
        headers: {
          'x-signature': `ts=${ts},v1=invalidsignature0123456789abcdef0123456789abcdef0123456789abcdef0123`,
          'x-request-id': 'req_test_123',
        },
        body: { data: { id: '999111' } },
        query: {},
      };

      let status = null;
      let body = null;
      const res = {
        status(s) { status = s; return this; },
        json(b) { body = b; return this; },
      };
      const next = jest.fn();

      await validateMercadopagoSignature(req, res, next);
      expect(status).toBe(401);
      expect(body.error).toMatch(/firma inválida/i);
      expect(next).not.toHaveBeenCalled();
    });

    test('Acepta firmas HMAC auténticas', async () => {
      const secret = 'test_secret_key_123';
      process.env.MERCADOPAGO_WEBHOOK_SECRET = secret;
      const ts = Math.floor(Date.now() / 1000);
      const dataId = '999111';
      const requestId = 'req_test_123';
      const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
      const validHmac = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

      const req = {
        headers: {
          'x-signature': `ts=${ts},v1=${validHmac}`,
          'x-request-id': requestId,
        },
        body: { data: { id: dataId } },
        query: {},
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      await validateMercadopagoSignature(req, res, next);
      expect(next).toHaveBeenCalled();
    });
  });

  // M2: customerMemoryService JSON string items parsing
  describe('M2: customerMemoryService maneja items serializados como JSON string', () => {
    test('Parsea correctamente items almacenados como string JSON', async () => {
      const origGetOrders = pedidosRepo.getOrdersByCustomerContext;
      pedidosRepo.getOrdersByCustomerContext = jest.fn().mockResolvedValue([
        {
          id: 555,
          estado: 'confirmado',
          items: JSON.stringify([{ nombre: 'Pintura Látex', cantidad: 3 }]),
          created_at: new Date('2026-05-01'),
        },
      ]);

      try {
        const profile = await customerMemoryService.getCustomerProfileContext({
          conversationId: 'conv_items_test',
          name: 'Juan Perez',
        });

        expect(profile.contextStr).toContain('Pintura Látex (x3)');
        expect(profile.contextStr).not.toContain('Productos varios');
      } finally {
        pedidosRepo.getOrdersByCustomerContext = origGetOrders;
      }
    });
  });

  // M6: configuracionController whitelist
  describe('M6: Whitelist de claves en configuracionController', () => {
    test('Rechaza modificación de claves no autorizadas con 400', async () => {
      let status = null;
      let body = null;
      const res = {
        status(s) { status = s; return this; },
        json(b) { body = b; return this; },
      };
      const next = jest.fn();

      await configuracionController.updateConfig({
        body: { key: 'JWT_SECRET', value: 'stolen_secret' },
      }, res, next);

      expect(status).toBe(400);
      expect(body.error).toMatch(/no permitida/i);

      await configuracionController.updateConfig({
        body: { key: 'DATABASE_PASSWORD', value: 'new_pass' },
      }, res, next);

      expect(status).toBe(400);
    });

    test('Permite modificación de claves válidas de configuración', async () => {
      let status = null;
      let body = null;
      const res = {
        status(s) { status = s; return this; },
        json(b) { body = b; return this; },
      };
      const next = jest.fn();

      await configuracionController.updateConfig({
        body: { key: 'msg_pedido_pendiente', value: 'Tu pedido está siendo procesado.' },
      }, res, next);

      expect(status).toBeNull(); // 200 OK
      expect(body.key).toBe('msg_pedido_pendiente');
    });
  });
});
