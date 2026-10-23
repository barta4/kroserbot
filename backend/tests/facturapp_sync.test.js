process.env.FACTURAPP_RETRY_BASE_MS = '1';

const {
  createFacturappSyncService,
  mapArticle,
  dedupeArticles,
  computeCutoff,
  estimatePages,
  normalizeDate,
  normalizeCurrency,
} = require('../services/facturapp/facturappSyncService');
const { FacturappError, request } = require('../services/facturapp/facturappClient');

// ─────────────────────────────────────────────────────────────
// Helpers: artículos, store en memoria y API falsa
// ─────────────────────────────────────────────────────────────
function art(id, overrides = {}) {
  return {
    id,
    codigo: `C${id}`,
    codigoBarras: '',
    descripcion: `Producto ${id}`,
    descripcionAvanzada: '',
    precioVenta: 100 + id,
    precioCompra: 50 + id,
    idMoneda: 2,
    moneda: 'U$S',
    ivaPorcentaje: 22,
    stockActual: 5,
    stockMinimo: 0,
    unidadMedida: 'Uni',
    idRamo: 1,
    idFamilia: 1,
    idGrupo: 1,
    idMarca: 0,
    idProveedor: 0,
    codigoProveedor: 'TEST',
    activo: true,
    fechaVigenciaPrecio: '2026-10-22T00:00:00',
    fechaUpdate: '2026-10-23T17:44:35.61',
    ...overrides,
  };
}

function norm(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function createFakeStore(options = {}) {
  const state = {
    id: 1,
    last_success_at: options.last_success_at || null,
    last_cutoff: null,
    pending_mode: null,
    pending_cutoff: null,
    pending_desde_id: null,
    pending_run_id: null,
  };

  const runs = new Map();
  const products = new Map();
  const productsById = new Map();
  let runSeq = 1;
  let productSeq = 1;

  for (const p of options.products || []) {
    const row = {
      id: productSeq++,
      sku: p.sku,
      facturapp_id: p.facturapp_id ?? null,
      contenido_hash: p.contenido_hash ?? null,
    };
    products.set(row.sku, row);
    productsById.set(row.id, row);
  }

  const selectLastCompleted = (mode) => {
    const found = [...runs.values()]
      .filter((r) => r.mode === mode && r.status === 'completed')
      .sort((a, b) => b.id - a.id)[0];
    return found ? [{ articles_received: found.articles_received }] : [];
  };

  const dbQuery = jest.fn(async (sql, params = []) => {
    const s = norm(sql);

    if (s.startsWith('select * from facturapp_sync_state')) {
      return { rows: [{ ...state }] };
    }

    if (s.startsWith('update facturapp_sync_runs set status = \'paused\'') && s.includes('started_at')) {
      return { rows: [] };
    }

    if (s.startsWith('update facturapp_sync_state') && s.includes('where pending_run_id is not null')) {
      const pending = runs.get(Number(state.pending_run_id));
      if (pending && ['completed', 'failed', 'cancelled'].includes(pending.status)) {
        state.pending_mode = null;
        state.pending_cutoff = null;
        state.pending_desde_id = null;
        state.pending_run_id = null;
      }
      return { rows: [] };
    }

    if (s.includes('from facturapp_sync_runs where mode = \'initial\'')) {
      return { rows: selectLastCompleted('initial') };
    }
    if (s.includes('from facturapp_sync_runs where mode = \'incremental\'')) {
      return { rows: selectLastCompleted('incremental') };
    }

    if (s.includes("from facturapp_sync_runs where status = 'running'")) {
      return { rows: [] };
    }

    if (s.startsWith('insert into facturapp_sync_runs')) {
      const run = {
        id: runSeq++,
        mode: params[0],
        status: 'running',
        triggered_by: params[1],
        started_at: new Date(),
        finished_at: null,
        cutoff: params[2],
        desde_id_inicial: params[3],
        last_desde_id: params[3],
        max_pages: params[4],
        pages_processed: 0,
        articles_received: 0,
        inserted: 0,
        updated: 0,
        unchanged: 0,
        deactivated: 0,
        credits_start: params[5],
        credits_consumed: 0,
        credits_end: params[5],
        errors: 0,
        last_error: null,
        last_request_id: null,
        stop_reason: null,
        dry_run: false,
      };
      runs.set(run.id, run);
      return { rows: [run] };
    }

    if (s.startsWith('update facturapp_sync_state set pending_mode')) {
      state.pending_mode = params[0];
      state.pending_cutoff = params[1] || null;
      state.pending_desde_id = params[2] ?? null;
      state.pending_run_id = params[3] ?? null;
      return { rows: [] };
    }

    if (s.startsWith('update facturapp_sync_state set last_success_at')) {
      state.last_success_at = new Date();
      state.last_cutoff = params[0] || null;
      state.pending_mode = null;
      state.pending_cutoff = null;
      state.pending_desde_id = null;
      state.pending_run_id = null;
      return { rows: [] };
    }

    if (s.includes('from facturapp_sync_runs where id = $1')) {
      const run = runs.get(Number(params[0]));
      return { rows: run ? [run] : [] };
    }

    if (s.startsWith('update facturapp_sync_runs set status = $1')) {
      const run = runs.get(Number(params[16]));
      if (run) {
        run.status = params[0];
        run.finished_at = params[1];
        run.last_desde_id = params[2];
        run.pages_processed = params[3];
        run.articles_received = params[4];
        run.inserted = params[5];
        run.updated = params[6];
        run.unchanged = params[7];
        run.deactivated = params[8];
        run.credits_start = params[9];
        run.credits_consumed = params[10];
        run.credits_end = params[11];
        run.errors = params[12];
        run.last_error = params[13];
        run.last_request_id = params[14];
        run.stop_reason = params[15];
      }
      return { rows: [] };
    }

    if (s.startsWith('select id, mode, status')) {
      return { rows: [...runs.values()].sort((a, b) => b.id - a.id) };
    }

    return { rows: [] };
  });

  const clientQuery = jest.fn(async (sql, params = []) => {
    const s = norm(sql);

    if (s === 'begin' || s === 'commit' || s === 'rollback') return { rows: [] };

    if (s.includes('from productos where sku = $1 for update')) {
      const row = products.get(params[0]);
      return {
        rows: row
          ? [{ id: row.id, facturapp_id: row.facturapp_id, contenido_hash: row.contenido_hash }]
          : [],
      };
    }

    if (s.startsWith('update productos set facturapp_id = $1 where id = $2')) {
      const row = productsById.get(Number(params[1]));
      if (row) row.facturapp_id = Number(params[0]);
      return { rows: [] };
    }

    if (s.startsWith('insert into productos')) {
      const facturappId = Number(params[0]);
      const sku = params[1];
      const hash = params[23];

      let row = [...products.values()].find((p) => Number(p.facturapp_id) === facturappId);
      if (row) {
        const oldSku = row.sku;
        row.sku = sku;
        row.contenido_hash = hash;
        if (oldSku !== sku) {
          products.delete(oldSku);
          products.set(sku, row);
        }
        return { rows: [{ is_inserted: false }] };
      }

      row = { id: productSeq++, sku, facturapp_id: facturappId, contenido_hash: hash };
      products.set(sku, row);
      productsById.set(row.id, row);
      return { rows: [{ is_inserted: true }] };
    }

    // Las operaciones de estado/corrida también pasan por la conexión de la transacción.
    return dbQuery(sql, params);
  });

  const client = { query: clientQuery, release: jest.fn() };

  return {
    state,
    runs,
    products,
    db: { query: dbQuery, getClient: jest.fn(async () => client) },
    client,
  };
}

function createFakeApi(options = {}) {
  const balance = options.balance ?? 50;
  const pages = [...(options.pages || [])];
  const calls = [];
  let credits = balance;

  return {
    calls,
    getBalance: jest.fn(async () => ({
      plan: 'Prueba',
      mensuales: 50,
      usadosMes: 50 - balance,
      disponiblesMes: balance,
      extra: 0,
      mes: '2026-10',
    })),
    listArticles: jest.fn(async (opts) => {
      calls.push(opts);
      const page = pages.shift();
      if (!page) throw new Error('Test sin página configurada');
      if (page instanceof Error) throw page;
      credits -= 1;
      return {
        articles: page.articles || [],
        siguienteDesdeId: page.siguienteDesdeId ?? null,
        creditos: { disponiblesMes: page.disponiblesMes ?? credits },
        requestId: page.requestId || null,
      };
    }),
  };
}

function buildService(store, api, env = {}) {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const redis = { set: jest.fn(async () => 'OK'), del: jest.fn(async () => 1) };
  const service = createFacturappSyncService({
    db: store.db,
    redis,
    logger,
    client: api,
    env: {
      NODE_ENV: 'test',
      FACTURAPP_API_KEY: 'test-key',
      FACTURAPP_SYNC_RESERVE_CREDITS: '5',
      FACTURAPP_SYNC_MAX_PAGES: '40',
      FACTURAPP_EXPECTED_ARTICLES: '',
      ...env,
    },
  });
  return { service, logger, redis };
}

describe('Facturapp — sincronización de catálogo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ───────────────────────────────────────────────────────────
  // Mapeo y utilidades puras
  // ───────────────────────────────────────────────────────────
  describe('Mapeo de artículos', () => {
    test('mapea los campos de Facturapp al catálogo local', () => {
      const mapped = mapArticle(art(7));
      expect(mapped.facturappId).toBe(7);
      expect(mapped.sku).toBe('C7');
      expect(mapped.nombre).toBe('Producto 7');
      expect(mapped.precio).toBe(107);
      expect(mapped.precioCosto).toBe(57);
      expect(mapped.moneda).toBe('USD');
      expect(mapped.stock).toBe(5);
      expect(mapped.stockStatus).toBe('in_stock');
      expect(mapped.discontinuado).toBe(false);
      expect(mapped.iva).toBe(22);
      expect(mapped.fechaUpdate).toBe('2026-10-23T20:44:35.610Z');
    });

    test('un artículo inactivo queda discontinuado y sin stock queda out_of_stock', () => {
      const mapped = mapArticle(art(8, { activo: false, stockActual: 0 }));
      expect(mapped.discontinuado).toBe(true);
      expect(mapped.stockStatus).toBe('out_of_stock');
    });

    test('campos ausentes quedan en null para no sobrescribir datos existentes', () => {
      const mapped = mapArticle({
        id: 9,
        codigo: 'C9',
        descripcion: 'Solo descripción',
        activo: true,
      });
      expect(mapped.precio).toBeNull();
      expect(mapped.precioCosto).toBeNull();
      expect(mapped.stock).toBeNull();
      expect(mapped.stockStatus).toBeNull();
      expect(mapped.moneda).toBeNull();
      expect(mapped.iva).toBeNull();
      expect(mapped.fechaUpdate).toBeNull();
    });

    test('normaliza moneda y fechas de Uruguay', () => {
      expect(normalizeCurrency('U$S')).toBe('USD');
      expect(normalizeCurrency('$')).toBe('UYU');
      expect(normalizeCurrency('UYU')).toBe('UYU');
      expect(normalizeDate('2026-10-23')).toBe('2026-10-23T03:00:00.000Z');
      expect(normalizeDate('2026-10-23T12:00:00Z')).toBe('2026-10-23T12:00:00Z');
    });

    test('deduplica por id y por código conservando el más reciente', () => {
      const rows = [
        art(1, { fechaUpdate: '2026-10-20T10:00:00' }),
        art(1, { fechaUpdate: '2026-10-23T10:00:00' }),
        art(2, { codigo: 'C1', fechaUpdate: '2026-10-22T10:00:00' }),
      ];
      const deduped = dedupeArticles(rows);
      expect(deduped).toHaveLength(1);
      expect(deduped[0].id).toBe(1);
    });

    test('calcula corte retrocediendo un día y páginas de 200', () => {
      expect(computeCutoff('2026-10-23T12:00:00.000Z')).toBe('2026-10-22T12:00:00.000Z');
      expect(estimatePages(401)).toBe(4); // 3 páginas de datos + 1 confirmación vacía
      expect(estimatePages(0)).toBe(1);
      expect(estimatePages(null)).toBeNull();
    });
  });

  // ───────────────────────────────────────────────────────────
  // Sincronización
  // ───────────────────────────────────────────────────────────
  describe('Ejecución de sincronización', () => {
    test('una respuesta vacía completa la corrida y consume 1 crédito', async () => {
      const store = createFakeStore({ last_success_at: '2026-10-23T12:00:00.000Z' });
      const api = createFakeApi({ pages: [{ articles: [], siguienteDesdeId: null }] });
      const { service } = buildService(store, api);

      const result = await service.runSync({ mode: 'incremental' });

      expect(result.status).toBe('completed');
      expect(result.pages).toBe(0);
      expect(result.received).toBe(0);
      expect(result.creditsConsumed).toBe(1);
      expect(api.calls[0].modificadosDesde).toBe('2026-10-22T12:00:00.000Z');
      expect(store.state.pending_mode).toBeNull();
      expect(store.state.last_success_at).not.toBeNull();
    });

    test('recorre múltiples páginas usando siguienteDesdeId hasta la respuesta vacía', async () => {
      const store = createFakeStore();
      const page1 = Array.from({ length: 200 }, (_, i) => art(i + 1));
      const api = createFakeApi({
        pages: [
          { articles: page1, siguienteDesdeId: 200 },
          { articles: [art(201)], siguienteDesdeId: 201 },
          { articles: [], siguienteDesdeId: null },
        ],
      });
      const { service } = buildService(store, api, { FACTURAPP_EXPECTED_ARTICLES: '201' });

      const result = await service.runSync({ mode: 'initial', confirmInitial: true });

      expect(result.status).toBe('completed');
      expect(result.pages).toBe(2);
      expect(result.received).toBe(201);
      expect(result.inserted).toBe(201);
      expect(result.creditsConsumed).toBe(3);
      expect(api.calls.map((c) => c.desdeId)).toEqual([0, 200, 201]);
      expect(store.products.size).toBe(201);
    });

    test('no duplica artículos repetidos en la misma página', async () => {
      const store = createFakeStore();
      const api = createFakeApi({
        pages: [
          {
            articles: [
              art(1),
              art(1),
              art(2, { codigo: 'C1', fechaUpdate: '2026-10-24T10:00:00' }),
            ],
            siguienteDesdeId: 2,
          },
          { articles: [], siguienteDesdeId: null },
        ],
      });
      const { service } = buildService(store, api, { FACTURAPP_EXPECTED_ARTICLES: '3' });

      const result = await service.runSync({ mode: 'initial', confirmInitial: true });

      expect(result.status).toBe('completed');
      expect(result.received).toBe(3);
      expect(result.inserted).toBe(1);
      expect(store.products.size).toBe(1);
      expect(store.products.get('C1').facturapp_id).toBe(2);
    });

    test('si falla una página queda pausada y se reanuda desde el último desdeId confirmado', async () => {
      const store = createFakeStore();
      const page1 = Array.from({ length: 200 }, (_, i) => art(i + 1));
      const api = createFakeApi({
        pages: [
          { articles: page1, siguienteDesdeId: 200 },
          new FacturappError('Servidor ocupado', { status: 503, retryable: true, requestId: 'req-503' }),
          { articles: [art(201)], siguienteDesdeId: 201 },
          { articles: [], siguienteDesdeId: null },
        ],
      });
      const { service } = buildService(store, api, { FACTURAPP_EXPECTED_ARTICLES: '201' });

      const first = await service.runSync({ mode: 'initial', confirmInitial: true });
      expect(first.status).toBe('paused');
      expect(first.errors).toBe(1);
      expect(first.completed).toBe(false);
      expect(store.state.pending_desde_id).toBe(200);
      expect(store.products.size).toBe(200);

      const second = await service.runSync({ mode: 'incremental' });
      expect(second.status).toBe('completed');
      expect(second.completed).toBe(true);
      expect(api.calls[2].desdeId).toBe(200);
      expect(store.products.size).toBe(201);
      expect(store.state.pending_mode).toBeNull();
    });

    test('se detiene sin llamar a la API si no hay créditos por encima de la reserva', async () => {
      const store = createFakeStore({ last_success_at: '2026-10-23T12:00:00.000Z' });
      const api = createFakeApi({ balance: 4 });
      const { service } = buildService(store, api);

      const result = await service.runSync({ mode: 'incremental' });

      expect(result.status).toBe('insufficient_credits');
      expect(api.listArticles).not.toHaveBeenCalled();
    });

    test('rechaza la inicial si el costo estimado supera el presupuesto disponible', async () => {
      const store = createFakeStore();
      const api = createFakeApi({ balance: 8 }); // 8 - 5 reserva = 3
      const { service } = buildService(store, api, { FACTURAPP_EXPECTED_ARTICLES: '1000' });

      const result = await service.runSync({ mode: 'initial', confirmInitial: true });

      expect(result.status).toBe('insufficient_credits');
      expect(result.pages).toBe(6); // 5 páginas de datos + 1 confirmación vacía
      expect(result.estimatedCost).toBe(6);
      expect(api.listArticles).not.toHaveBeenCalled();
    });

    test('exige confirmación explícita antes de la sincronización inicial', async () => {
      const store = createFakeStore();
      const api = createFakeApi({ balance: 50 });
      const { service } = buildService(store, api, { FACTURAPP_EXPECTED_ARTICLES: '1000' });

      const result = await service.runSync({ mode: 'initial' });

      expect(result.status).toBe('confirmation_required');
      expect(result.pages).toBe(6); // 5 páginas de datos + 1 confirmación vacía
      expect(api.listArticles).not.toHaveBeenCalled();
    });

    test('exige sincronización inicial antes de la incremental', async () => {
      const store = createFakeStore();
      const api = createFakeApi({ balance: 50 });
      const { service } = buildService(store, api);

      const result = await service.runSync({ mode: 'incremental' });

      expect(result.status).toBe('initial_required');
      expect(api.listArticles).not.toHaveBeenCalled();
    });

    test('un error no reintentable marca la corrida como failed y conserva requestId', async () => {
      const store = createFakeStore();
      const api = createFakeApi({
        pages: [new FacturappError('No autorizado', { status: 401, retryable: false, requestId: 'req-401' })],
      });
      const { service } = buildService(store, api, { FACTURAPP_EXPECTED_ARTICLES: '200' });

      const result = await service.runSync({ mode: 'initial', confirmInitial: true });

      expect(result.status).toBe('failed');
      expect(result.errors).toBe(1);
      expect(result.lastRequestId).toBe('req-401');
      expect(store.state.pending_mode).toBe('initial');
      const run = [...store.runs.values()][0];
      expect(run.status).toBe('failed');
      expect(run.last_request_id).toBe('req-401');
    });

    test('una respuesta con paginación estancada no se declara exitosa', async () => {
      const store = createFakeStore();
      const api = createFakeApi({
        pages: [
          { articles: [art(1)], siguienteDesdeId: 0 },
          { articles: [], siguienteDesdeId: null },
        ],
      });
      const { service } = buildService(store, api, { FACTURAPP_EXPECTED_ARTICLES: '1' });

      const result = await service.runSync({ mode: 'initial', confirmInitial: true });

      expect(result.status).toBe('failed');
      expect(result.stopReason).toBe('pagination_stalled');
      expect(result.completed).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────
  // Cliente HTTP: reintentos y seguridad
  // ───────────────────────────────────────────────────────────
  describe('Cliente HTTP', () => {
    const originalKey = process.env.FACTURAPP_API_KEY;
    const originalFetch = global.fetch;

    function response(status, body, headers = {}) {
      return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
          get: (name) => headers[String(name).toLowerCase()] || null,
        },
        text: async () => JSON.stringify(body),
      };
    }

    beforeEach(() => {
      process.env.FACTURAPP_API_KEY = 'test-key';
      delete process.env.FACTURAPP_API_URL;
    });

    afterEach(() => {
      global.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.FACTURAPP_API_KEY;
      else process.env.FACTURAPP_API_KEY = originalKey;
    });

    test('reintenta 503 y devuelve la respuesta exitosa', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce(response(503, { error: { message: 'busy' } }))
        .mockResolvedValueOnce(response(200, { ok: true, datos: { plan: 'Prueba' }, requestId: 'ok-1' }));

      const result = await request('cuenta/saldo');

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result.data.plan).toBe('Prueba');
      expect(result.requestId).toBe('ok-1');
    });

    test('no reintenta errores de autenticación', async () => {
      global.fetch = jest.fn().mockResolvedValue(
        response(401, { error: { type: 'unauthorized', message: 'Clave inválida' }, requestId: 'req-401' })
      );

      await expect(request('cuenta/saldo')).rejects.toMatchObject({
        status: 401,
        requestId: 'req-401',
        retryable: false,
      });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('falla claro si falta FACTURAPP_API_KEY sin hacer requests', async () => {
      delete process.env.FACTURAPP_API_KEY;
      global.fetch = jest.fn();

      await expect(request('cuenta/saldo')).rejects.toMatchObject({ code: 'missing_api_key' });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
