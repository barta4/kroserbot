const request = require('supertest');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const promptBuilder = require('../services/webhook/promptBuilder');
const toolExecutor = require('../services/webhook/toolExecutor');
const configuracionRepo = require('../repositories/configuracionRepository');
const pedidosRoutes = require('../routes/pedidosRoutes');

describe('Order Taking Toggle Feature (Toma de Pedidos Habilitada / Deshabilitada)', () => {
  let app;
  let adminToken;

  beforeAll(() => {
    adminToken = jwt.sign(
      { username: 'admin', role: 'admin' },
      process.env.JWT_SECRET || 'test_jwt_secret_at_least_32_characters_1234567890'
    );

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/pedidos', pedidosRoutes);
  });

  beforeEach(async () => {
    // Reset to enabled before each test
    await configuracionRepo.set('pedidos_enabled', 'true');
  });

  afterAll(async () => {
    // Ensure it remains enabled
    await configuracionRepo.set('pedidos_enabled', 'true');
  });

  describe('1. Configuration Repository Defaults & Persistence', () => {
    test('Default value for pedidos_enabled is true', async () => {
      const origGet = configuracionRepo.get;
      const val = await configuracionRepo.get('pedidos_enabled');
      expect(val).toBe('true');
    });

    test('Can update pedidos_enabled to false and read back', async () => {
      await configuracionRepo.set('pedidos_enabled', 'false');
      const val = await configuracionRepo.get('pedidos_enabled');
      expect(val).toBe('false');
    });
  });

  describe('2. PromptBuilder Dynamic Adaptation', () => {
    test('System prompt includes normal order taking instructions when enabled', async () => {
      await configuracionRepo.set('pedidos_enabled', 'true');
      const prompt = await promptBuilder.buildSystemPrompt();

      expect(prompt).toContain('6. TOMA Y REGISTRO DE PEDIDOS (VALIDACIÓN ESTRICTA)');
      expect(prompt).toContain("invoque la herramienta 'registrar_pedido'");
      expect(prompt).not.toContain('(PAUSADA TEMPORALMENTE)');
    });

    test('System prompt adapts to paused order taking when pedidos_enabled is false', async () => {
      await configuracionRepo.set('pedidos_enabled', 'false');
      const prompt = await promptBuilder.buildSystemPrompt();

      expect(prompt).toContain('6. TOMA Y REGISTRO DE PEDIDOS (PAUSADA TEMPORALMENTE)');
      expect(prompt).toContain('kroser.com.uy');
      expect(prompt).toContain('NO solicite datos de envío ni intente registrar pedidos');
      expect(prompt).not.toContain('(VALIDACIÓN ESTRICTA)');
    });
  });

  describe('3. Tool Filtering in Gemini & OpenAI declarations', () => {
    test('getGeminiTools excludes registrar_pedido when enableOrders is false', () => {
      const toolsDisabled = toolExecutor.getGeminiTools({ enableOrders: false });
      const funcNamesDisabled = toolsDisabled[0].functionDeclarations.map((f) => f.name);
      expect(funcNamesDisabled).not.toContain('registrar_pedido');
      expect(funcNamesDisabled).toContain('buscar_productos');
      expect(funcNamesDisabled).toContain('consultar_pedido');

      const toolsEnabled = toolExecutor.getGeminiTools({ enableOrders: true });
      const funcNamesEnabled = toolsEnabled[0].functionDeclarations.map((f) => f.name);
      expect(funcNamesEnabled).toContain('registrar_pedido');
    });

    test('getOpenAITools excludes registrar_pedido when enableOrders is false', () => {
      const toolsDisabled = toolExecutor.getOpenAITools({ enableOrders: false });
      const funcNamesDisabled = toolsDisabled.map((t) => t.function.name);
      expect(funcNamesDisabled).not.toContain('registrar_pedido');
      expect(funcNamesDisabled).toContain('buscar_productos');
      expect(funcNamesDisabled).toContain('consultar_pedido');

      const toolsEnabled = toolExecutor.getOpenAITools({ enableOrders: true });
      const funcNamesEnabled = toolsEnabled.map((t) => t.function.name);
      expect(funcNamesEnabled).toContain('registrar_pedido');
    });
  });

  describe('4. Tool Executor Safe Guarding', () => {
    test('executeTool rejects registrar_pedido when orders are disabled', async () => {
      await configuracionRepo.set('pedidos_enabled', 'false');

      const result = await toolExecutor.executeTool('registrar_pedido', {
        cliente: { nombre: 'Juan Pérez', telefono: '099111222' },
        items: [{ sku: 'TEST-1', nombre: 'Pala', cantidad: 1, precio: 100 }],
      });

      expect(result.status).toBe('disabled');
      expect(result.mensaje).toContain('deshabilitada');
      expect(result.createdOrder).toBeNull();
    });
  });

  describe('5. HTTP Toggle Endpoints in pedidosRoutes', () => {
    test('GET /api/pedidos/toggle-status returns current enabled state', async () => {
      await configuracionRepo.set('pedidos_enabled', 'true');

      const res = await request(app)
        .get('/api/pedidos/toggle-status')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
    });

    test('POST /api/pedidos/toggle successfully toggles state', async () => {
      const resDisable = await request(app)
        .post('/api/pedidos/toggle')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: false });

      expect(resDisable.status).toBe(200);
      expect(resDisable.body.success).toBe(true);
      expect(resDisable.body.enabled).toBe(false);

      const dbVal = await configuracionRepo.get('pedidos_enabled');
      expect(dbVal).toBe('false');

      const resEnable = await request(app)
        .post('/api/pedidos/toggle')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: true });

      expect(resEnable.status).toBe(200);
      expect(resEnable.body.success).toBe(true);
      expect(resEnable.body.enabled).toBe(true);
    });

    test('POST /api/pedidos/toggle rejects invalid non-boolean payload', async () => {
      const res = await request(app)
        .post('/api/pedidos/toggle')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ enabled: 'not_a_boolean' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('booleano');
    });

    test('POST /api/pedidos/toggle requires authentication', async () => {
      const res = await request(app)
        .post('/api/pedidos/toggle')
        .send({ enabled: false });

      expect(res.status).toBe(401);
    });
  });
});
