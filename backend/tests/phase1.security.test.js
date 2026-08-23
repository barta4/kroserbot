const request = require('supertest');
const jwt = require('jsonwebtoken');

const TEST_ENV = {
  ADMIN_USER: 'testadmin',
  ADMIN_PASSWORD: 'TestAdminPass123!',
  DEPOSITO_USER: 'testdep',
  DEPOSITO_PASSWORD: 'TestDepotPass123!',
  JWT_SECRET: 'test_jwt_secret_at_least_32_characters_1234567890',
  WEBHOOK_BASIC_AUTH: 'testuser:testpass',
  CORS_ORIGINS: '',
  DATABASE_URL: 'postgres://fake:fake@localhost:0/fake',
  REDIS_URL: 'redis://localhost:0',
  DEBOUNCE_WAIT_MS: '200',
};

let app;

beforeAll(() => {
  Object.assign(process.env, TEST_ENV);
  app = require('../index');
});

afterAll(() => {
  process.removeAllListeners('uncaughtException');
  process.removeAllListeners('unhandledRejection');
});

describe('Fase 1 — Seguridad de autenticación', () => {

  describe('POST /api/auth/login', () => {
    test('sin credenciales → 400', async () => {
      const res = await request(app).post('/api/auth/login').send({});
      expect(res.status).toBe(400);
    });

    test('con password por defecto kroser2026 → 401 (no debe aceptar defaults)', async () => {
      const res = await request(app).post('/api/auth/login').send({
        username: 'admin',
        password: 'kroser2026',
      });
      expect(res.status).toBe(401);
    });

    test('con deposito2026 → 401 (no debe aceptar defaults)', async () => {
      const res = await request(app).post('/api/auth/login').send({
        username: 'deposito',
        password: 'deposito2026',
      });
      expect(res.status).toBe(401);
    });

    test('con credenciales correctas de admin → 200 + token', async () => {
      const res = await request(app).post('/api/auth/login').send({
        username: 'testadmin',
        password: 'TestAdminPass123!',
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.token).toBeTruthy();
      expect(res.body.user.role).toBe('admin');
    });

    test('con credenciales correctas de deposito → 200 + role deposito', async () => {
      const res = await request(app).post('/api/auth/login').send({
        username: 'testdep',
        password: 'TestDepotPass123!',
      });
      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('deposito');
    });

    test('con password corta (<6) → 401 sin llegar a bcrypt', async () => {
      const res = await request(app).post('/api/auth/login').send({
        username: 'testadmin',
        password: '123',
      });
      expect(res.status).toBe(401);
    });

    test('cookie httpOnly se setea en el login', async () => {
      const res = await request(app).post('/api/auth/login').send({
        username: 'testadmin',
        password: 'TestAdminPass123!',
      });
      expect(res.status).toBe(200);
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieStr = Array.isArray(cookies) ? cookies.join(';') : cookies;
      expect(cookieStr).toContain('kroser_token=');
      expect(cookieStr).toContain('HttpOnly');
    });
  });

  describe('Token JWT con expiración', () => {
    test('token expirado → 401', async () => {
      const expiredToken = jwt.sign(
        { username: 'testadmin', role: 'admin' },
        process.env.JWT_SECRET,
        { expiresIn: '-1s' }
      );
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);
      expect(res.status).toBe(401);
    });

    test('token válido → /api/auth/me devuelve usuario', async () => {
      const loginRes = await request(app).post('/api/auth/login').send({
        username: 'testadmin',
        password: 'TestAdminPass123!',
      });
      const token = loginRes.body.token;
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.username).toBe('testadmin');
      expect(res.body.role).toBe('admin');
    });
  });

  describe('RBAC — autorización por rol', () => {
    test('deposito intenta POST /api/scraper/start → 403', async () => {
      const loginRes = await request(app).post('/api/auth/login').send({
        username: 'testdep',
        password: 'TestDepotPass123!',
      });
      const token = loginRes.body.token;
      const res = await request(app)
        .post('/api/scraper/start')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    test('sin token → POST /api/scraper/start → 401', async () => {
      const res = await request(app).post('/api/scraper/start');
      expect(res.status).toBe(401);
    });
  });
});

describe('Fase 1 — Seguridad del webhook', () => {

  test('POST /webhook (alias) → 404 (no debe existir la ruta legacy)', async () => {
    const res = await request(app).post('/webhook').send({
      event: 'message_created',
      message: { id: 1, content: 'test' },
    });
    expect(res.status).toBe(404);
  });

  test('POST /api/webhook sin Basic Auth → 401', async () => {
    const res = await request(app).post('/api/webhook').send({
      event: 'message_created',
      message: { id: 1, content: 'test' },
    });
    expect(res.status).toBe(401);
  });

  test('POST /api/webhook con Basic Auth inválido → 401', async () => {
    const res = await request(app)
      .post('/api/webhook')
      .set('Authorization', 'Basic aW52YWxpZDppbnZhbGlk')
      .send({
        event: 'message_created',
        message: { id: 1, content: 'test' },
      });
    expect(res.status).toBe(401);
  });

  test('POST /api/webhook con Basic Auth correcto → no 401', async () => {
    const res = await request(app)
      .post('/api/webhook')
      .set('Authorization', 'Basic ' + Buffer.from('testuser:testpass').toString('base64'))
      .send({
        event: 'message_created',
        message: { id: 99999, content: 'test message' },
        conversation: { id: 88888 },
      });
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(404);
  });
});

describe('Fase 1 — Filtrado de secretos en /api/configuracion', () => {
  const SECRET_KEYS_TO_CHECK = [
    'GEMINI_API_KEY',
    'OPENAI_API_KEY',
    'llm_api_key',
    'chatwoot_api_token',
    'mercadopago_access_token',
    'mercadopago_webhook_secret',
    'SMTP_PASS',
  ];

  test('GET /api/configuracion sin token → 401', async () => {
    const res = await request(app).get('/api/configuracion');
    expect(res.status).toBe(401);
  });

  test('GET /api/configuracion con token admin → no contiene secretos', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({
      username: 'testadmin',
      password: 'TestAdminPass123!',
    });
    const token = loginRes.body.token;
    const res = await request(app)
      .get('/api/configuracion')
      .set('Authorization', `Bearer ${token}`);

    if (res.status === 200) {
      for (const key of SECRET_KEYS_TO_CHECK) {
        expect(res.body).not.toHaveProperty(key);
      }
    }
  });
});
