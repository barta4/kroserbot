import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { loadProducts } from './storage.js';

// Cargar variables de entorno desde .env
try {
  process.loadEnvFile?.();
} catch {
  // Si no existe .env, continúa con los valores por defecto
}

const PORT = Number(process.env.PORT) || 3030;
const HOST = process.env.HOST || '0.0.0.0';

// Lista de API Keys válidas
const VALID_API_KEYS = (process.env.API_KEYS || 'equus_secret_token_123')
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean);

const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 60;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60000;

const fastify = Fastify({
  logger: true
});

// 1. Rate Limiting (Protección contra ataques DoS o flood)
fastify.register(rateLimit, {
  max: RATE_LIMIT_MAX,
  timeWindow: RATE_LIMIT_WINDOW_MS,
  errorResponseBuilder: () => ({
    statusCode: 429,
    error: 'Too Many Requests',
    message: `Has superado el límite de ${RATE_LIMIT_MAX} solicitudes por minuto. Aguarda antes de reintentar.`
  })
});

// 2. Middleware de Autenticación (Hook onRequest)
fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
  const url = request.url.split('?')[0];

  // Endpoints públicos: Home y Health Check
  if (url === '/' || url === '/v1/health' || url === '/favicon.ico') {
    return;
  }

  // Extraer token desde cabeceras o query string (para comodidad en navegador)
  const headerApiKey = request.headers['x-api-key'] as string | undefined;
  const authHeader = request.headers['authorization'];
  let bearerToken: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.substring(7).trim();
  }

  const queryApiKey = (request.query as Record<string, string>)?.api_key;
  const providedKey = headerApiKey || bearerToken || queryApiKey;

  if (!providedKey || !VALID_API_KEYS.includes(providedKey)) {
    return reply.status(401).send({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Acceso denegado. Se requiere una API Key válida.',
      authentication_methods: [
        "Header: 'x-api-key: <TU_TOKEN>'",
        "Header: 'Authorization: Bearer <TU_TOKEN>'",
        "Query param (navegador): '?api_key=<TU_TOKEN>'"
      ]
    });
  }
});

// --- RUTAS PÚBLICAS ---

// Health check
fastify.get('/v1/health', async () => {
  const products = loadProducts();
  const lastSync = products.reduce((acc, p) => (!acc || p.last_checked_at > acc ? p.last_checked_at : acc), '');

  return {
    status: 'ok',
    service: 'scraequus-api',
    auth_enabled: true,
    uptime_seconds: Math.floor(process.uptime()),
    stats: {
      total_products: products.length,
      last_sync_at: lastSync || null
    }
  };
});

// Home informativa / Welcome
fastify.get('/', async () => {
  return {
    name: 'Scraequus API - Catálogo Equus Uruguay',
    version: '1.0.0',
    security: {
      auth_required: true,
      headers_supported: ['x-api-key: <token>', 'Authorization: Bearer <token>', '?api_key=<token>']
    },
    documentation: {
      health: 'GET /v1/health (público)',
      categories: 'GET /v1/categories (requiere token)',
      products_list: 'GET /v1/products?search=escalera&limit=10 (requiere token)',
      product_detail: 'GET /v1/products/:code (requiere token)'
    }
  };
});

// --- RUTAS PROTEGIDAS ---

// Listado de categorías únicas
fastify.get('/v1/categories', async () => {
  const products = loadProducts();
  const categories = [...new Set(products.map((p) => p.category))].filter(Boolean);

  return {
    total: categories.length,
    categories
  };
});

// Búsqueda y listado de productos
fastify.get('/v1/products', async (request) => {
  const query = request.query as {
    search?: string;
    category?: string;
    availability?: string;
    min_price?: string;
    max_price?: string;
    limit?: string;
    offset?: string;
  };

  const allProducts = loadProducts();
  let filtered = allProducts;

  if (query.search) {
    const term = query.search.toLowerCase();
    filtered = filtered.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.source_id.toLowerCase().includes(term) ||
        p.description.toLowerCase().includes(term)
    );
  }

  if (query.category) {
    const cat = query.category.toLowerCase();
    filtered = filtered.filter((p) => p.category.toLowerCase().includes(cat));
  }

  if (query.availability) {
    filtered = filtered.filter((p) => p.availability === query.availability);
  }

  if (query.min_price) {
    const min = parseFloat(query.min_price);
    if (!isNaN(min)) {
      filtered = filtered.filter((p) => p.price.amount >= min);
    }
  }

  if (query.max_price) {
    const max = parseFloat(query.max_price);
    if (!isNaN(max)) {
      filtered = filtered.filter((p) => p.price.amount <= max);
    }
  }

  const limit = Math.max(1, Math.min(100, parseInt(query.limit || '20', 10)));
  const offset = Math.max(0, parseInt(query.offset || '0', 10));
  const paginated = filtered.slice(offset, offset + limit);

  return {
    total: filtered.length,
    limit,
    offset,
    products: paginated
  };
});

// Ficha de producto por código / SKU
fastify.get('/v1/products/:code', async (request, reply) => {
  const { code } = request.params as { code: string };
  const products = loadProducts();

  const product = products.find(
    (p) => p.source_id.toLowerCase() === code.toLowerCase() || p.internal_id === code
  );

  if (!product) {
    reply.status(404);
    return {
      statusCode: 404,
      error: 'Not Found',
      message: `No se encontró ningún producto con el código o SKU "${code}"`
    };
  }

  return {
    product
  };
});

async function start() {
  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`\n🔒 API REST de Scraequus (con autenticación por token) escuchando en http://localhost:${PORT}`);
    console.log(`🔑 Tokens activos: ${VALID_API_KEYS.join(', ')}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
