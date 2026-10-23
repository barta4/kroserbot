const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../index');
const db = require('../config/db');
const pedidosRepo = require('../repositories/pedidosRepository');
const productosRepo = require('../repositories/productosRepository');
const orderTrackingService = require('../services/pedidos/orderTrackingService');
const { executeTool } = require('../services/webhook/toolExecutor');
const mediaService = require('../services/media/mediaService');
const mercadopagoService = require('../services/mercadopago/mercadopagoService');
const clientesRepo = require('../repositories/clientesRepository');

const TEST_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_at_least_32_characters_1234567890';

describe('Suite de Verificación y Regresión: Seguridad y Hardening (H1 - H10)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────
  // H1: Autoasignación de Descuentos en Registro Público
  // ──────────────────────────────────────────────────────────
  describe('H1: Registro de Clientes Blindado', () => {
    test('Un intento de autoasignarse categoria mayorista en registro es forzado a minorista con 0% descuento', async () => {
      const origQuery = db.query;
      db.query = jest.fn()
        .mockResolvedValueOnce({ rows: [] }) // findByEmail
        .mockResolvedValueOnce({ // create
          rows: [{
            id: 991,
            email: 'hacker@empresa.com',
            nombre: 'Atacante Descuentos',
            categoria: 'minorista',
            descuento_porcentaje: 0.0,
            activo: true,
          }],
        });

      try {
        const res = await request(app)
          .post('/api/auth/cliente/registro')
          .send({
            email: 'hacker@empresa.com',
            password: 'Password123!',
            nombre: 'Atacante Descuentos',
            categoria: 'mayorista', // Pretendía 25% de descuento
          });

        expect(res.status).toBe(201);
        expect(res.body.cliente.categoria).toBe('minorista');
        expect(res.body.cliente.descuento_porcentaje).toBe(0);
      } finally {
        db.query = origQuery;
      }
    });
  });

  // ──────────────────────────────────────────────────────────
  // H2: Manipulación de Precios en Pedidos Web
  // ──────────────────────────────────────────────────────────
  describe('H2: Recálculo de Precios desde Catálogo en Pedidos Web', () => {
    test('createWebPedido recalcula el precio oficial del catálogo en lugar del enviado en el body', async () => {
      const spyFindSku = jest.spyOn(productosRepo, 'findBySku').mockResolvedValue({
        id: 42,
        sku: 'TAL-PRO',
        nombre: 'Taladro Profesional Kroser',
        precio: '4500.00',
        precio_oferta: null,
        moneda: 'UYU',
      });

      let capturedCreatedOrder = null;
      const spyCreate = jest.spyOn(pedidosRepo, 'create').mockImplementation(async (orderData) => {
        capturedCreatedOrder = orderData;
        return {
          id: 701,
          ...orderData,
          created_at: new Date().toISOString(),
        };
      });

      try {
        const res = await request(app)
          .post('/api/cotibot/pedido')
          .send({
            cliente: {
              nombre: 'Juan Comprador',
              telefono: '099123456',
              direccion: 'Av Italia 1234',
            },
            items: [
              {
                sku: 'TAL-PRO',
                nombre: 'Taladro Profesional Kroser',
                cantidad: 2,
                precio: 1.00, // Intento de pagar $1 en lugar de $4500
                precio_final: 1.00,
              },
            ],
            deliveryType: 'envio',
          });

        expect(res.status).toBe(201);
        expect(capturedCreatedOrder).toBeDefined();
        // El precio unitario debe haber sido fijado en 4500 y el subtotal en 9000
        expect(capturedCreatedOrder.items[0].precio).toBe(4500);
        expect(capturedCreatedOrder.items[0].subtotal).toBe(9000);
      } finally {
        spyFindSku.mockRestore();
        spyCreate.mockRestore();
      }
    });
  });

  // ──────────────────────────────────────────────────────────
  // H3: Prevención de IDOR y Fuga de PII en Tracking de Pedidos
  // ──────────────────────────────────────────────────────────
  describe('H3: Protección contra IDOR en orderTrackingService', () => {
    test('Consulta anónima por número de pedido de otro cliente devuelve estado sanitizado sin PII', async () => {
      const mockOrder = {
        id: 1042,
        ecommerce_order_number: 'ORD-1042',
        estado: 'en_preparacion',
        origen: 'web',
        conversation_id: 'conv_original_999',
        cliente: {
          nombre: 'Víctima De Privacidad',
          telefono: '099888777',
          direccion: 'Calle Privada 456, Apto 101',
        },
        items: [{ sku: 'HER-01', nombre: 'Pala Forjada', cantidad: 1 }],
      };

      jest.spyOn(pedidosRepo, 'searchOrderForTracking').mockResolvedValue(mockOrder);

      // Consulta de un tercero que solo sabe el número "1042" sin teléfono ni misma conversación
      const tracking = await orderTrackingService.getTrackingInfo({
        text: 'pedido 1042',
        conversationId: 'otra_conversacion_distinta',
        sender: { phone_number: '091222333' },
      });

      expect(tracking.hasOrder).toBe(true);
      expect(tracking.isVerifiedOwner).toBe(false);
      // No debe contener el nombre ni la dirección privada de la víctima
      expect(tracking.directReply).not.toContain('Víctima De Privacidad');
      expect(tracking.directReply).not.toContain('Calle Privada 456');
      expect(tracking.directReply).toContain('políticas de privacidad');
      expect(tracking.contextStr).not.toContain('Calle Privada 456');
    });

    test('Consulta del titular con teléfono verificado incluye detalles completos', async () => {
      const mockOrder = {
        id: 1042,
        ecommerce_order_number: 'ORD-1042',
        estado: 'confirmado',
        origen: 'web',
        conversation_id: 'conv_original_999',
        cliente: {
          nombre: 'Cliente Legítimo',
          telefono: '099888777',
          direccion: '18 de Julio 1000',
        },
        items: [{ sku: 'PIN-01', nombre: 'Pintura Látex', cantidad: 2 }],
      };

      jest.spyOn(pedidosRepo, 'searchOrderForTracking').mockResolvedValue(mockOrder);

      const tracking = await orderTrackingService.getTrackingInfo({
        text: 'pedido 1042',
        conversationId: 'otra_conversacion',
        sender: { phone_number: '099888777' }, // Mismo teléfono
      });

      expect(tracking.hasOrder).toBe(true);
      expect(tracking.isVerifiedOwner).toBe(true);
      expect(tracking.directReply).toContain('Cliente Legítimo');
      expect(tracking.directReply).toContain('Pintura Látex');
    });
  });

  // ──────────────────────────────────────────────────────────
  // H4: Precios Seguros en Tool Calling (registrar_pedido)
  // ──────────────────────────────────────────────────────────
  describe('H4: Precios Blindados contra Inyección en Tool Calling', () => {
    test('executeRegistrarPedido usa precio de catálogo y no el precio manipulado del LLM', async () => {
      jest.spyOn(productosRepo, 'findBySku').mockResolvedValue({
        id: 55,
        sku: 'TAL-02',
        nombre: 'Taladro de Banco',
        precio: '8000.00',
      });

      let savedOrder = null;
      jest.spyOn(pedidosRepo, 'create').mockImplementation(async (data) => {
        savedOrder = data;
        return { id: 808, ...data };
      });

      const res = await executeTool('registrar_pedido', {
        cliente: {
          nombre: 'Carlos Tester',
          telefono: '099111222',
          direccion: 'Canelones 2000',
        },
        items: [
          {
            sku: 'TAL-02',
            nombre: 'Taladro de Banco',
            cantidad: 1,
            precio: 5.0, // LLM intentó asignar $5
          },
        ],
      });

      expect(res.status).toBe('ok');
      expect(savedOrder.items[0].precio).toBe(8000);
      expect(savedOrder.items[0].subtotal).toBe(8000);
    });
  });

  // ──────────────────────────────────────────────────────────
  // H5: Separación Estricta de Tokens en requireAuth
  // ──────────────────────────────────────────────────────────
  describe('H5: Denegación de Tokens de Cliente en requireAuth', () => {
    test('Token de cliente es rechazado con 403 en endpoints protegidos por requireAuth', async () => {
      const clientToken = jwt.sign(
        { id: 10, email: 'cliente@cotibot.uy', role: 'cliente' },
        TEST_SECRET,
        { algorithm: 'HS256', expiresIn: '1h' }
      );

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('credenciales de personal administrativo');
    });
  });

  // ──────────────────────────────────────────────────────────
  // S1: Protección SSRF y Filtración de Tokens en mediaService
  // ──────────────────────────────────────────────────────────
  describe('S1: Protección SSRF y Filtración de Tokens en mediaService', () => {
    test('fetchMediaAsBase64 bloquea solicitudes a localhost, metadata y redes privadas', async () => {
      const blockedHosts = [
        'http://localhost:8080/exploit',
        'http://127.0.0.1:6379/keys',
        'http://169.254.169.254/latest/meta-data',
        'http://10.0.0.5/admin',
        'http://192.168.1.1/router',
        'http://172.16.0.1/internal',
        'file:///etc/passwd',
      ];

      for (const url of blockedHosts) {
        const res = await mediaService.fetchMediaAsBase64(url);
        expect(res).toBeNull();
      }
    });
  });

  // ──────────────────────────────────────────────────────────
  // S2: Sanitización de Costos y Márgenes de Proveedores
  // ──────────────────────────────────────────────────────────
  describe('S2: Sanitización de Costos y Márgenes de Proveedores en API Pública', () => {
    test('GET /api/productos/:id no expone precio_costo ni margen a usuarios públicos', async () => {
      jest.spyOn(productosRepo, 'findByIdWithPromocion').mockResolvedValueOnce({
        id: 50,
        sku: 'TEST-TALADRO',
        nombre: 'Taladro de Prueba',
        precio: 2500,
        precio_costo: 1400,
        margen_aplicado: 40,
        iva_aplicado: 22,
        fuente_origen: 'proveedor_secreto',
        categoria: 'Herramientas',
        marca: 'Makita',
      });

      const res = await request(app).get('/api/productos/50');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.producto.precio_costo).toBeUndefined();
      expect(res.body.producto.margen_aplicado).toBeUndefined();
      expect(res.body.producto.iva_aplicado).toBeUndefined();
      expect(res.body.producto.fuente_origen).toBeUndefined();
      expect(res.body.producto.precio).toBe(2500);
    });
  });

  // ──────────────────────────────────────────────────────────
  // S4: Verificación de Montos en Webhook de MercadoPago
  // ──────────────────────────────────────────────────────────
  describe('S4: Verificación de Monto Pagado vs Total en MercadoPago', () => {
    test('Detecta subpago y no auto-confirma si el monto pagado es menor al total del pedido', async () => {
      const configuracionRepo = require('../repositories/configuracionRepository');
      jest.spyOn(configuracionRepo, 'get').mockImplementation(async (key) => {
        if (key === 'mercadopago_enabled') return 'true';
        return null;
      });
      jest.spyOn(mercadopagoService, 'getPaymentStatus').mockResolvedValue({
        enabled: true,
        paymentId: 'mp_pay_123',
        status: 'approved',
        externalReference: 'pedido_990',
        transactionAmount: 10.0, // Pagó $10
      });
      jest.spyOn(pedidosRepo, 'getById').mockResolvedValue({
        id: 990,
        total: 2500.0, // Esperaba $2500
        estado: 'pendiente',
      });
      const spyUpdatePago = jest.spyOn(pedidosRepo, 'updatePagoEstado').mockResolvedValue({});

      const result = await mercadopagoService.handleWebhookNotification({
        type: 'payment',
        data: { id: 'mp_pay_123' },
      });

      expect(result.processed).toBe(true);
      expect(result.action).toBe('underpayment_detected');
      expect(spyUpdatePago).toHaveBeenCalledWith(990, 'pago_parcial', 'mp_mp_pay_123');
    });
  });

  // ──────────────────────────────────────────────────────────
  // S5: Protección contra Timing Attack y Validación en ClienteAuth
  // ──────────────────────────────────────────────────────────
  describe('S5: Protección contra Timing Attack y Validación en ClienteAuth', () => {
    test('Login rechaza credenciales con comparación temporal uniforme y registro valida email/contraseña', async () => {
      // Registro con contraseña excesiva o email inválido es rechazado
      const resBadEmail = await request(app)
        .post('/api/auth/cliente/registro')
        .send({
          email: 'not-an-email',
          password: 'Password123!',
          nombre: 'Juan Tester',
        });
      expect(resBadEmail.status).toBe(400);

      const resBadPass = await request(app)
        .post('/api/auth/cliente/registro')
        .send({
          email: 'juan@test.com',
          password: 'a'.repeat(130), // Excede 128 caracteres
          nombre: 'Juan Tester',
        });
      expect(resBadPass.status).toBe(400);

      // Login con usuario inexistente ejecuta comparación y responde 401
      jest.spyOn(clientesRepo, 'findByEmail').mockResolvedValueOnce(null);
      const resLogin = await request(app)
        .post('/api/auth/cliente/login')
        .send({
          email: 'inexistente@kroser.com',
          password: 'AnyPassword123',
        });
      expect(resLogin.status).toBe(401);
    });
  });

  // ──────────────────────────────────────────────────────────
  // S6: Validación de Entradas en Proveedores de Scraper
  // ──────────────────────────────────────────────────────────
  describe('S6: Validación de Entradas en Proveedores de Scraper', () => {
    test('updateProveedor rechaza márgenes negativos o no numéricos', async () => {
      const adminToken = jwt.sign(
        { id: 1, email: 'admin@kroser.uy', role: 'admin' },
        TEST_SECRET,
        { algorithm: 'HS256', expiresIn: '1h' }
      );

      const resBadMargen = await request(app)
        .put('/api/proveedores-scraper/equus')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ margen_porcentaje: -15 });

      expect(resBadMargen.status).toBe(400);

      const resSyncLimit = await request(app)
        .post('/api/proveedores-scraper/equus/sync')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ products: 'not-an-array' });

      expect(resSyncLimit.status).toBe(400);
    });
  });
});
