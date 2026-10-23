const request = require('supertest');
const app = require('../index');
const pricingCalculator = require('../utils/pricingCalculator');
const db = require('../config/db');
const clientesRepo = require('../repositories/clientesRepository');
const pedidosRepo = require('../repositories/pedidosRepository');
const emailService = require('../services/email/emailService');
const bcrypt = require('bcryptjs');
const mediaService = require('../services/media/mediaService');

describe('Cotibot — Landing, Client Auth & Discount System Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ──────────────────────────────────────────────────────────
  // 1. PRICING CALCULATOR TESTS
  // ──────────────────────────────────────────────────────────
  describe('1. Motor de Precios y Descuentos (pricingCalculator)', () => {
    const demoProduct = {
      id: 10,
      sku: 'TAL-001',
      nombre: 'Taladro Percutor 750W',
      precio: 2000,
      precio_oferta: null,
      moneda: 'UYU',
    };

    test('Consumidor sin login o minorista recibe precio de lista completo (0% OFF)', () => {
      const anonResult = pricingCalculator.calculateProductPrice(demoProduct, null);
      expect(anonResult.precio_final).toBe(2000);
      expect(anonResult.descuento_porcentaje).toBe(0);
      expect(anonResult.ahorro_monto).toBe(0);

      const minoristaResult = pricingCalculator.calculateProductPrice(demoProduct, { categoria: 'minorista' });
      expect(minoristaResult.precio_final).toBe(2000);
      expect(minoristaResult.descuento_porcentaje).toBe(0);
    });

    test('Profesional recibe 10% de descuento automático ($ 1.800)', () => {
      const result = pricingCalculator.calculateProductPrice(demoProduct, { categoria: 'profesional' });
      expect(result.precio_final).toBe(1800);
      expect(result.descuento_porcentaje).toBe(10);
      expect(result.ahorro_monto).toBe(200);
    });

    test('Gremio recibe 15% de descuento automático ($ 1.700)', () => {
      const result = pricingCalculator.calculateProductPrice(demoProduct, { categoria: 'gremio' });
      expect(result.precio_final).toBe(1700);
      expect(result.descuento_porcentaje).toBe(15);
      expect(result.ahorro_monto).toBe(300);
    });

    test('Empresa recibe 20% de descuento automático ($ 1.600)', () => {
      const result = pricingCalculator.calculateProductPrice(demoProduct, { categoria: 'empresa' });
      expect(result.precio_final).toBe(1600);
      expect(result.descuento_porcentaje).toBe(20);
      expect(result.ahorro_monto).toBe(400);
    });

    test('Descuento manual personalizado en perfil anula el por defecto', () => {
      const client = { categoria: 'profesional', descuento_porcentaje: 25.0 };
      const result = pricingCalculator.calculateProductPrice(demoProduct, client);
      expect(result.precio_final).toBe(1500);
      expect(result.descuento_porcentaje).toBe(25);
      expect(result.ahorro_monto).toBe(500);
    });

    test('Si hay oferta pública más barata que el descuento, el cliente recibe la mejor oferta', () => {
      const promoProduct = {
        ...demoProduct,
        precio: 2000,
        precio_oferta: 1500, // Menor que el 10% de profesional ($1.800)
      };
      const result = pricingCalculator.calculateProductPrice(promoProduct, { categoria: 'profesional' });
      expect(result.precio_final).toBe(1500);
      expect(result.ahorro_monto).toBe(500);
    });
  });

  // ──────────────────────────────────────────────────────────
  // 2. CLIENT AUTHENTICATION CONTROLLER TESTS
  // ──────────────────────────────────────────────────────────
  describe('2. Autenticación de Clientes (/api/auth/cliente)', () => {
    const testEmail = `test_${Date.now()}@cotibot.uy`;
    let clientToken = null;

    test('Registro exitoso de nuevo cliente con asignación segura de categoría minorista inicial', async () => {
      const origQuery = db.query;
      // Mock db query para simular registro seguro (inicia minorista, sin escalamiento no autorizado)
      db.query = jest.fn()
        .mockResolvedValueOnce({ rows: [] }) // findByEmail -> no existe
        .mockResolvedValueOnce({ // create -> insert
          rows: [{
            id: 88,
            email: testEmail,
            nombre: 'Juan Instalador',
            empresa_razon_social: 'Instalaciones Juan',
            categoria: 'minorista',
            descuento_porcentaje: 0.0,
            activo: true,
          }],
        });

      try {
        const res = await request(app)
          .post('/api/auth/cliente/registro')
          .send({
            email: testEmail,
            password: 'Password123!',
            nombre: 'Juan Instalador',
            empresa_razon_social: 'Instalaciones Juan',
            categoria: 'gremio', // Intento de autoasignación debe ser neutralizado a minorista
          });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.token).toBeDefined();
        expect(res.body.cliente.categoria).toBe('minorista');
        expect(res.body.cliente.descuento_porcentaje).toBe(0);
      } finally {
        db.query = origQuery;
      }
    });

    test('Rechaza registro con email inválido o contraseña corta', async () => {
      const res = await request(app)
        .post('/api/auth/cliente/registro')
        .send({
          email: 'no-email',
          password: '123',
          nombre: 'Incompleto',
        });

      expect(res.status).toBe(400);
    });

    test('Login exitoso genera token con datos de descuento', async () => {
      const hash = bcrypt.hashSync('Password123!', 10);
      const origQuery = db.query;
      db.query = jest.fn().mockResolvedValueOnce({
        rows: [{
          id: 88,
          email: testEmail,
          password_hash: hash,
          nombre: 'Juan Instalador',
          categoria: 'gremio',
          descuento_porcentaje: 15.0,
          activo: true,
        }],
      });

      try {
        const res = await request(app)
          .post('/api/auth/cliente/login')
          .send({
            email: testEmail,
            password: 'Password123!',
          });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.cliente.categoria).toBe('gremio');
        expect(res.body.cliente.descuento_porcentaje).toBe(15);
        clientToken = res.body.token;
      } finally {
        db.query = origQuery;
      }
    });

    test('Login rechaza credenciales incorrectas con 401', async () => {
      const hash = bcrypt.hashSync('Password123!', 10);
      const origQuery = db.query;
      db.query = jest.fn().mockResolvedValueOnce({
        rows: [{
          id: 88,
          email: testEmail,
          password_hash: hash,
          activo: true,
        }],
      });

      try {
        const res = await request(app)
          .post('/api/auth/cliente/login')
          .send({
            email: testEmail,
            password: 'WrongPassword',
          });

        expect(res.status).toBe(401);
      } finally {
        db.query = origQuery;
      }
    });

    test('GET /api/auth/cliente/me devuelve los datos del cliente autenticado', async () => {
      const res = await request(app)
        .get('/api/auth/cliente/me')
        .set('Authorization', `Bearer ${clientToken}`);

      expect(res.status).toBe(200);
      expect(res.body.cliente.email).toBe(testEmail);
      expect(res.body.cliente.categoria).toBe('gremio');
    });
  });

  // ──────────────────────────────────────────────────────────
  // 3. PRODUCT CATALOG WITH CLIENT PRICING
  // ──────────────────────────────────────────────────────────
  describe('3. Catálogo con Precios Bonificados Dinámicos (/api/productos)', () => {
    test('Petición pública sin token devuelve lista de productos con precio normal', async () => {
      const res = await request(app).get('/api/productos?limit=4');
      expect(res.status).toBe(200);
      expect(res.body.items).toBeDefined();
      expect(Array.isArray(res.body.items)).toBe(true);
      if (res.body.items.length > 0) {
        expect(res.body.items[0].precio_final).toBeDefined();
      }
    });

    test('Categorías endpoint /api/productos/categorias responde correctamente', async () => {
      const res = await request(app).get('/api/productos/categorias');
      expect(res.status).toBe(200);
      expect(res.body.categorias).toBeDefined();
      expect(Array.isArray(res.body.categorias)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────
  // 4. COTIBOT AI ASSISTANT CHAT ENDPOINT
  // ──────────────────────────────────────────────────────────
  describe('4. Asistente Cotibot Chat (/api/cotibot/chat)', () => {
    test('Rechaza mensajes vacíos con 400', async () => {
      const res = await request(app)
        .post('/api/cotibot/chat')
        .send({ message: '' });

      expect(res.status).toBe(400);
    });

    test('Procesa consulta y devuelve respuesta cordial', async () => {
      const res = await request(app)
        .post('/api/cotibot/chat')
        .send({
          message: 'Hola, tienen pintura latex interior blanca?',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.reply).toBeDefined();
      expect(typeof res.body.reply).toBe('string');
      expect(res.body.productos).toBeDefined();
    });

    test('Procesa lista de materiales y devuelve cotización multi-artículo (isMaterialList: true)', async () => {
      const res = await request(app)
        .post('/api/cotibot/chat')
        .send({
          message: '1 taladro percutor\n2 cintas aisladoras\n1 pintura latex',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.isMaterialList).toBe(true);
      expect(res.body.listaItems).toBeDefined();
      expect(res.body.listaItems.length).toBeGreaterThanOrEqual(2);
      expect(res.body.totalEstimado).toBeDefined();
    });

    test('Procesa nota de voz (audio) sin texto y devuelve transcripción', async () => {
      const mediaSpy = jest.spyOn(mediaService, 'processMessageAttachments').mockResolvedValueOnce({
        mediaSummaries: ['[Audio transcripto: "preciso 2 latas de pintura sintetica"]'],
        transcribedTexts: ['preciso 2 latas de pintura sintetica'],
        visualSearchTerms: [],
        identifiedParts: [],
      });

      const res = await request(app)
        .post('/api/cotibot/chat')
        .send({
          message: '',
          audio: 'data:audio/webm;base64,GkXfo59ChoEBQveBAULygQ8USA==',
          mimeType: 'audio/webm',
        });

      expect(mediaSpy).toHaveBeenCalled();
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.transcription).toBe('preciso 2 latas de pintura sintetica');
      expect(res.body.reply).toBeDefined();

      mediaSpy.mockRestore();
    });

    test('Procesa foto de repuesto con Visual Parts Finder y devuelve identificación', async () => {
      const mediaSpy = jest.spyOn(mediaService, 'processMessageAttachments').mockResolvedValueOnce({
        mediaSummaries: ['[Foto del cliente identificada: Cartucho cerámico 35mm para canilla monocomando]'],
        transcribedTexts: [],
        visualSearchTerms: ['cartucho ceramico 35mm canilla'],
        identifiedParts: ['Cartucho cerámico 35mm'],
      });

      const res = await request(app)
        .post('/api/cotibot/chat')
        .send({
          message: '¿Tienen este repuesto?',
          image: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/',
          mimeType: 'image/jpeg',
        });

      expect(mediaSpy).toHaveBeenCalled();
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.mediaAnalysis).toBeDefined();
      expect(res.body.mediaAnalysis.identifiedParts).toContain('Cartucho cerámico 35mm');

      mediaSpy.mockRestore();
    });
  });

  // ──────────────────────────────────────────────────────────
  // 5. LANDING STATIC SERVING & INTEGRATION
  // ──────────────────────────────────────────────────────────
  describe('5. Landing Page y Acceso Web', () => {
    test('GET / sirve la Landing Page comercial de Cotibot (HTML)', async () => {
      const res = await request(app).get('/');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('Cotibot');
      expect(res.text).toContain('heroSearchInput');
    });

    test('GET /admin/ sigue sirviendo el panel administrativo existente', async () => {
      const res = await request(app).get('/admin/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Krosmart AI');
    });
  });

  // ──────────────────────────────────────────────────────────
  // 6. FLUJO DE PEDIDOS WEB (POST /api/cotibot/pedido)
  // ──────────────────────────────────────────────────────────
  describe('6. Flujo de Toma de Pedidos Web (POST /api/cotibot/pedido)', () => {
    const validItems = [
      {
        id: 101,
        sku: 'HER-01',
        nombre: 'Destornillador Buscapolo 14cm',
        cantidad: 2,
        precio_final: 162,
        precio_lista: 162,
        moneda: 'UYU',
      },
      {
        id: 102,
        sku: 'HAR-50',
        nombre: 'Luz de Trabajo LED 50W Harden',
        cantidad: 1,
        precio_final: 76.95,
        precio_lista: 76.95,
        moneda: 'USD',
      },
    ];

    test('Rechaza pedido si los items o el carrito están vacíos', async () => {
      const res = await request(app)
        .post('/api/cotibot/pedido')
        .send({
          cliente: { nombre: 'Juan Pérez', telefono: '099123456' },
          items: [],
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('artículo');
    });

    test('Rechaza pedido si falta nombre o teléfono del cliente', async () => {
      const resSinNombre = await request(app)
        .post('/api/cotibot/pedido')
        .send({
          cliente: { nombre: '', telefono: '099123456' },
          items: validItems,
        });

      expect(resSinNombre.status).toBe(400);
      expect(resSinNombre.body.success).toBe(false);
      expect(resSinNombre.body.error).toContain('nombre');

      const resSinTel = await request(app)
        .post('/api/cotibot/pedido')
        .send({
          cliente: { nombre: 'Juan Pérez', telefono: '' },
          items: validItems,
        });

      expect(resSinTel.status).toBe(400);
      expect(resSinTel.body.success).toBe(false);
      expect(resSinTel.body.error).toContain('teléfono');
    });

    test('Registra pedido web con éxito (modalidad envío a domicilio)', async () => {
      const mockOrder = {
        id: 501,
        conversation_id: 'web_cotibot_123',
        account_id: 1,
        cliente: {
          nombre: 'Ana Gómez',
          telefono: '098765432',
          email: 'ana@ejemplo.com',
          direccion: 'Av. Rivera 2500 apto 4',
          modalidad_entrega: 'Envío a Domicilio',
        },
        items: validItems,
        total: 400.95,
        created_at: new Date().toISOString(),
      };

      const spyCreate = jest.spyOn(pedidosRepo, 'create').mockResolvedValueOnce(mockOrder);
      const spyEmail = jest.spyOn(emailService, 'sendNewOrderAlert').mockResolvedValueOnce(true);

      const res = await request(app)
        .post('/api/cotibot/pedido')
        .send({
          cliente: {
            nombre: 'Ana Gómez',
            telefono: '098765432',
            email: 'ana@ejemplo.com',
            direccion: 'Av. Rivera 2500 apto 4',
            forma_pago: 'Transferencia bancaria',
          },
          items: validItems,
          deliveryType: 'envio',
          notas: 'Dejar en portería por favor',
        });

      expect(spyCreate).toHaveBeenCalled();
      const callArgs = spyCreate.mock.calls[0][0];
      expect(callArgs.origen).toBe('web');
      expect(callArgs.cliente.nombre).toBe('Ana Gómez');
      expect(callArgs.cliente.modalidad_entrega).toBe('Envío a Domicilio');
      expect(callArgs.cliente.direccion).toBe('Av. Rivera 2500 apto 4');
      expect(callArgs.cliente.notas).toBe('Dejar en portería por favor');

      expect(spyEmail).toHaveBeenCalledWith(mockOrder);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.pedido).toBeDefined();
      expect(res.body.pedido.id).toBe(501);
      expect(res.body.pedido.referencia).toBe('#501');
      expect(res.body.pedido.cliente).toBe('Ana Gómez');
      expect(res.body.pedido.modalidad_entrega).toBe('Envío a Domicilio');

      spyCreate.mockRestore();
      spyEmail.mockRestore();
    });

    test('Registra pedido web con retiro en sucursal Kroser Martínez', async () => {
      const mockOrder = {
        id: 502,
        cliente: {
          nombre: 'Carlos Constructor',
          telefono: '099000111',
          modalidad_entrega: 'Retiro en Sucursal',
          direccion: 'Sucursal Kroser Martínez (Av. General Flores 2800)',
        },
        items: validItems,
        created_at: new Date().toISOString(),
      };

      const spyCreate = jest.spyOn(pedidosRepo, 'create').mockResolvedValueOnce(mockOrder);

      const res = await request(app)
        .post('/api/cotibot/pedido')
        .send({
          cliente: {
            nombre: 'Carlos Constructor',
            telefono: '099000111',
            direccion: 'Sucursal Kroser Martínez (Av. General Flores 2800)',
            sucursal_retiro: 'Sucursal Kroser Martínez (Av. General Flores 2800)',
            forma_pago: 'Efectivo en mostrador',
          },
          items: validItems,
          deliveryType: 'retiro',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.pedido.referencia).toBe('#502');
      expect(res.body.pedido.modalidad_entrega).toBe('Retiro en Sucursal');

      spyCreate.mockRestore();
    });
  });
});
