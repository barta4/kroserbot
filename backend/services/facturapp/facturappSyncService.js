/**
 * Sincronización del catálogo Facturapp.
 *
 * Estrategia:
 * - Inicial: recorre el maestro con desdeId/siguienteDesdeId, 200 por página.
 * - Incremental: modificadosDesde = última sincronización exitosa - 1 día.
 * - Cada página se confirma en una transacción y el estado queda reanudable.
 * - Se detiene antes de agotar los créditos (margen configurable).
 */
const crypto = require('crypto');

const PAGE_SIZE = 200;
const LOCK_KEY = 'facturapp:sync:lock';
const LOCK_TTL_SECONDS = 6 * 60 * 60;
const STALE_RUN_HOURS = 6;

function intEnv(env, key, fallback) {
  const parsed = parseInt(env[key], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function normalizeCurrency(value) {
  if (!value) return null;
  const raw = String(value).trim().toUpperCase();
  if (raw === 'U$S' || raw === 'US$' || raw === 'USD') return 'USD';
  if (raw === '$' || raw === 'UYU' || raw === 'U$') return 'UYU';
  return raw.slice(0, 10);
}

function normalizeDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  // La API entrega fechas sin zona horaria (hora Uruguay, UTC-3).
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) return raw;
  const withTime = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw;
  const parsed = new Date(`${withTime}-03:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeSku(article) {
  const raw = article?.codigo || article?.codigoBarras || '';
  const code = String(raw).trim();
  return (code || `FACT-${article?.id}`).slice(0, 100);
}

function effectiveDiscountHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

/**
 * Mapea un artículo Facturapp al modelo local sin perder campos ausentes.
 */
function mapArticle(article) {
  const facturappId = Number(article?.id);
  if (!Number.isFinite(facturappId)) {
    throw new Error('Artículo Facturapp sin id válido');
  }

  const descripcion = String(article.descripcion || '').trim() || null;
  const descripcionAvanzada = String(article.descripcionAvanzada || '').trim() || null;
  const nombre = descripcion || descripcionAvanzada || `Artículo ${facturappId}`;
  const sku = normalizeSku(article);
  const precio = toNum(article.precioVenta);
  const precioCosto = toNum(article.precioCompra);
  const stock = toNum(article.stockActual);
  const stockMinimo = toNum(article.stockMinimo);
  const iva = toNum(article.ivaPorcentaje);
  const activo = typeof article.activo === 'boolean' ? article.activo : null;
  const moneda = normalizeCurrency(article.moneda);
  const fechaUpdate = normalizeDate(article.fechaUpdate);
  const discontinuado = activo === null ? null : !activo;
  const stockStatus = stock === null ? null : stock > 0 ? 'in_stock' : 'out_of_stock';

  const mapped = {
    facturappId,
    sku,
    nombre,
    descripcion: descripcionAvanzada || descripcion,
    precio,
    precioCosto,
    moneda,
    stock,
    stockMinimo,
    stockStatus,
    iva,
    activo,
    discontinuado,
    fechaUpdate,
    codigoOriginal: String(article.codigo || '').trim() || null,
    codigoBarras: String(article.codigoBarras || '').trim() || null,
    unidadMedida: String(article.unidadMedida || '').trim().slice(0, 20) || null,
    idRamo: Number.isFinite(Number(article.idRamo)) ? Number(article.idRamo) : null,
    idFamilia: Number.isFinite(Number(article.idFamilia)) ? Number(article.idFamilia) : null,
    idGrupo: Number.isFinite(Number(article.idGrupo)) ? Number(article.idGrupo) : null,
    idMarca: Number.isFinite(Number(article.idMarca)) ? Number(article.idMarca) : null,
    idProveedor: Number.isFinite(Number(article.idProveedor)) ? Number(article.idProveedor) : null,
  };

  mapped.contenidoHash = effectiveDiscountHash({
    facturappId: mapped.facturappId,
    sku: mapped.sku,
    nombre: mapped.nombre,
    descripcion: mapped.descripcion,
    precio: mapped.precio,
    precioCosto: mapped.precioCosto,
    moneda: mapped.moneda,
    stock: mapped.stock,
    stockMinimo: mapped.stockMinimo,
    stockStatus: mapped.stockStatus,
    iva: mapped.iva,
    activo: mapped.activo,
    fechaUpdate: mapped.fechaUpdate,
    unidadMedida: mapped.unidadMedida,
  });

  return mapped;
}

/**
 * Elimina duplicados por id y por código dentro de una misma página.
 * Si dos ids distintos comparten código, conserva el de fechaUpdate más reciente.
 */
function dedupeArticles(rows = []) {
  const byId = new Map();
  for (const row of rows) {
    const id = Number(row?.id);
    if (!Number.isFinite(id)) continue;
    const previous = byId.get(id);
    if (!previous || new Date(row.fechaUpdate || 0) >= new Date(previous.fechaUpdate || 0)) {
      byId.set(id, row);
    }
  }

  const bySku = new Map();
  for (const row of byId.values()) {
    const sku = normalizeSku(row);
    const previous = bySku.get(sku);
    if (!previous || new Date(row.fechaUpdate || 0) >= new Date(previous.fechaUpdate || 0)) {
      bySku.set(sku, row);
    }
  }

  return [...bySku.values()];
}

/**
 * Fecha de corte para el incremental: última sincronización exitosa - 1 día.
 */
function computeCutoff(lastSuccessAt) {
  if (!lastSuccessAt) return null;
  const base = new Date(lastSuccessAt);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() - 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Estimación conservadora de consultas pagadas.
 * Incluye la página final vacía que confirma que no hay más resultados.
 * Sin artículos esperados, el mínimo es 1 consulta (la que verifica si hay cambios).
 */
function estimatePages(expectedArticles) {
  if (expectedArticles === null || expectedArticles === undefined || expectedArticles === '') {
    return null;
  }
  const expected = Number(expectedArticles);
  if (!Number.isFinite(expected) || expected <= 0) return 1;
  return Math.ceil(expected / PAGE_SIZE) + 1;
}

const UPSERT_SQL = `
  INSERT INTO productos (
    facturapp_id, sku, nombre, precio, precio_costo, moneda, descripcion,
    stock_status, stock_actual, stock_minimo, unidad_medida, iva_porcentaje,
    discontinuado, facturapp_codigo, facturapp_codigo_barras, facturapp_activo,
    facturapp_updated_at, facturapp_id_ramo, facturapp_id_familia, facturapp_id_grupo,
    facturapp_id_marca, facturapp_id_proveedor, facturapp_raw,
    fuente_origen, contenido_hash, updated_at, categoria, marca, imagen_url, producto_url
  )
  VALUES (
    $1, $2, $3, $4, $5, $6, $7,
    COALESCE($8, 'in_stock'), $9, $10, $11, $12,
    COALESCE($13, FALSE), $14, $15, $16,
    $17, $18, $19, $20,
    $21, $22, $23::jsonb,
    'facturapp', $24, NOW(), COALESCE($25, 'General'), $26, $27, $28
  )
  ON CONFLICT (facturapp_id) DO UPDATE SET
    sku = EXCLUDED.sku,
    nombre = COALESCE(NULLIF(EXCLUDED.nombre, ''), productos.nombre),
    precio = COALESCE(EXCLUDED.precio, productos.precio),
    precio_costo = COALESCE(EXCLUDED.precio_costo, productos.precio_costo),
    moneda = COALESCE(EXCLUDED.moneda, productos.moneda),
    descripcion = COALESCE(NULLIF(EXCLUDED.descripcion, ''), productos.descripcion),
    stock_status = COALESCE(EXCLUDED.stock_status, productos.stock_status),
    stock_actual = COALESCE(EXCLUDED.stock_actual, productos.stock_actual),
    stock_minimo = COALESCE(EXCLUDED.stock_minimo, productos.stock_minimo),
    unidad_medida = COALESCE(EXCLUDED.unidad_medida, productos.unidad_medida),
    iva_porcentaje = COALESCE(EXCLUDED.iva_porcentaje, productos.iva_porcentaje),
    discontinuado = COALESCE(EXCLUDED.discontinuado, productos.discontinuado),
    facturapp_codigo = COALESCE(EXCLUDED.facturapp_codigo, productos.facturapp_codigo),
    facturapp_codigo_barras = COALESCE(EXCLUDED.facturapp_codigo_barras, productos.facturapp_codigo_barras),
    facturapp_activo = COALESCE(EXCLUDED.facturapp_activo, productos.facturapp_activo),
    facturapp_updated_at = COALESCE(EXCLUDED.facturapp_updated_at, productos.facturapp_updated_at),
    facturapp_id_ramo = COALESCE(EXCLUDED.facturapp_id_ramo, productos.facturapp_id_ramo),
    facturapp_id_familia = COALESCE(EXCLUDED.facturapp_id_familia, productos.facturapp_id_familia),
    facturapp_id_grupo = COALESCE(EXCLUDED.facturapp_id_grupo, productos.facturapp_id_grupo),
    facturapp_id_marca = COALESCE(EXCLUDED.facturapp_id_marca, productos.facturapp_id_marca),
    facturapp_id_proveedor = COALESCE(EXCLUDED.facturapp_id_proveedor, productos.facturapp_id_proveedor),
    facturapp_raw = COALESCE(EXCLUDED.facturapp_raw, productos.facturapp_raw),
    fuente_origen = 'facturapp',
    contenido_hash = EXCLUDED.contenido_hash,
    updated_at = NOW()
  RETURNING (xmax = 0) AS is_inserted;
`;

function createFacturappSyncService(overrides = {}) {
  const db = overrides.db || require('../../config/db');
  const redis = overrides.redis || require('../../config/redis');
  const logger = overrides.logger || require('../../config/logger');
  const api = overrides.client || require('./facturappClient');
  const env = overrides.env || process.env;
  const clock = overrides.now || (() => new Date());

  const config = {
    reserveCredits: Math.max(0, intEnv(env, 'FACTURAPP_SYNC_RESERVE_CREDITS', 5)),
    maxPages: Math.max(1, intEnv(env, 'FACTURAPP_SYNC_MAX_PAGES', 40)),
    expectedArticles: Math.max(0, intEnv(env, 'FACTURAPP_EXPECTED_ARTICLES', 0)),
    autoConfirmInitial: String(env.FACTURAPP_SYNC_AUTO_CONFIRM_INITIAL || 'false') === 'true',
    pageSize: PAGE_SIZE,
  };

  async function getState() {
    const res = await db.query('SELECT * FROM facturapp_sync_state WHERE id = 1');
    return res.rows[0] || null;
  }

  async function getBalance() {
    return api.getBalance();
  }

  async function getRecentRuns(limit = 10) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 100);
    const res = await db.query(
      `SELECT id, mode, status, triggered_by, dry_run, started_at, finished_at, cutoff,
              last_desde_id, pages_processed, articles_received, inserted, updated,
              unchanged, deactivated, credits_start, credits_consumed, credits_end,
              errors, last_error, last_request_id, stop_reason
       FROM facturapp_sync_runs
       ORDER BY id DESC
       LIMIT $1`,
      [safeLimit]
    );
    return res.rows;
  }

  async function getStatus() {
    let balance = null;
    let apiError = null;
    try {
      balance = await getBalance();
    } catch (err) {
      apiError = err.message;
    }

    let state = null;
    let runs = [];
    try {
      state = await getState();
      runs = await getRecentRuns(10);
    } catch (err) {
      apiError = apiError || err.message;
    }

    return {
      configured: Boolean(env.FACTURAPP_API_KEY),
      balance,
      apiError,
      state,
      runs,
      config: {
        reserveCredits: config.reserveCredits,
        maxPages: config.maxPages,
        pageSize: config.pageSize,
        expectedArticles: config.expectedArticles || null,
      },
    };
  }

  async function estimate({ mode = 'incremental' } = {}) {
    const balance = await getBalance();
    const state = await getState();
    const available = Math.max(0, balance.disponiblesMes - config.reserveCredits);
    const pending = Boolean(state?.pending_mode);

    if (!pending && mode === 'incremental' && !state?.last_success_at) {
      return {
        status: 'initial_required',
        mode,
        balance,
        reserveCredits: config.reserveCredits,
        available,
        message: 'No existe una sincronización inicial exitosa. Ejecutá primero el modo initial.',
      };
    }

    let expectedArticles = null;
    let cutoff = null;
    let pages = null;

    if (pending) {
      cutoff = state.pending_cutoff;
      const lastRun = state.pending_run_id
        ? await db.query('SELECT articles_received, pages_processed FROM facturapp_sync_runs WHERE id = $1', [state.pending_run_id])
        : null;
      expectedArticles = lastRun?.rows?.[0]?.articles_received || null;
      pages = null;
    } else if (mode === 'initial') {
      expectedArticles = config.expectedArticles || null;
      if (!expectedArticles) {
        const lastInitial = await db.query(
          "SELECT articles_received FROM facturapp_sync_runs WHERE mode = 'initial' AND status = 'completed' ORDER BY finished_at DESC LIMIT 1"
        );
        expectedArticles = lastInitial.rows?.[0]?.articles_received || null;
      }
      pages = estimatePages(expectedArticles);
    } else {
      cutoff = computeCutoff(state.last_success_at);
      const lastIncremental = await db.query(
        "SELECT articles_received FROM facturapp_sync_runs WHERE mode = 'incremental' AND status = 'completed' ORDER BY finished_at DESC LIMIT 1"
      );
      expectedArticles = lastIncremental.rows?.[0]?.articles_received || null;
      pages = Math.max(1, estimatePages(expectedArticles) || 1);
    }

    const estimatedCost = pages;
    return {
      status: 'ok',
      mode: pending ? state.pending_mode : mode,
      pending,
      balance,
      reserveCredits: config.reserveCredits,
      available,
      expectedArticles,
      pages,
      estimatedCost,
      sufficient: estimatedCost === null ? null : estimatedCost <= available,
      cutoff,
      pageSize: PAGE_SIZE,
      note:
        expectedArticles === null
          ? 'No hay historial suficiente para estimar páginas. El proceso se detendrá por presupuesto y podrá reanudarse.'
          : undefined,
    };
  }

  async function prepareRun({ mode = 'incremental', maxPages, confirmInitial = false, trigger = 'manual' } = {}) {
    if (!['initial', 'incremental'].includes(mode)) {
      return { status: 'invalid_mode', message: 'mode debe ser initial o incremental' };
    }

    const balance = await getBalance();
    const state = await getState();
    const available = Math.max(0, balance.disponiblesMes - config.reserveCredits);

    if (available < 1) {
      return {
        status: 'insufficient_credits',
        balance,
        available,
        reserveCredits: config.reserveCredits,
        message: 'No hay créditos suficientes por encima del margen de reserva.',
      };
    }

    let effectiveMode = mode;
    let cutoff = null;
    let desdeId = 0;

    if (state?.pending_mode) {
      effectiveMode = state.pending_mode;
      cutoff = state.pending_cutoff || null;
      desdeId = Number(state.pending_desde_id) || 0;
    } else if (mode === 'incremental') {
      if (!state?.last_success_at) {
        return {
          status: 'initial_required',
          message: 'No existe sincronización inicial exitosa. Ejecutá primero el modo initial.',
        };
      }
      cutoff = computeCutoff(state.last_success_at);
    }

    let expectedArticles = config.expectedArticles || null;
    if (!expectedArticles) {
      if (effectiveMode === 'initial') {
        const lastInitial = await db.query(
          "SELECT articles_received FROM facturapp_sync_runs WHERE mode = 'initial' AND status = 'completed' ORDER BY finished_at DESC LIMIT 1"
        );
        expectedArticles = lastInitial.rows?.[0]?.articles_received || null;
      } else {
        const lastIncremental = await db.query(
          "SELECT articles_received FROM facturapp_sync_runs WHERE mode = 'incremental' AND status = 'completed' ORDER BY finished_at DESC LIMIT 1"
        );
        expectedArticles = lastIncremental.rows?.[0]?.articles_received || null;
      }
    }

    const pagesNeeded = estimatePages(expectedArticles);
    if (
      effectiveMode === 'initial' &&
      !state?.pending_mode &&
      !confirmInitial &&
      !config.autoConfirmInitial
    ) {
      return {
        status: 'confirmation_required',
        balance,
        available,
        reserveCredits: config.reserveCredits,
        expectedArticles,
        pages: pagesNeeded,
        estimatedCost: pagesNeeded,
        sufficient: pagesNeeded === null ? null : pagesNeeded <= available,
        message:
          'La sincronización inicial recorre el catálogo completo. Confirmá con confirmInitial=true para continuar.',
      };
    }

    if (!state?.pending_mode && pagesNeeded !== null && pagesNeeded > available) {
      return {
        status: 'insufficient_credits',
        balance,
        available,
        reserveCredits: config.reserveCredits,
        expectedArticles,
        pages: pagesNeeded,
        estimatedCost: pagesNeeded,
        sufficient: false,
        message: `Se necesitan ~${pagesNeeded} créditos y solo hay ${available} disponibles por encima de la reserva.`,
      };
    }

    const requestedMax = Math.max(1, parseInt(maxPages, 10) || config.maxPages);
    const effectiveMaxPages = Math.min(requestedMax, available);

    if (state?.pending_mode) {
      // Lock + run already exist? Reuse the pending run so the history is complete.
      const pendingRun = state.pending_run_id
        ? await db.query('SELECT * FROM facturapp_sync_runs WHERE id = $1', [state.pending_run_id])
        : null;
      if (pendingRun?.rows?.[0] && ['running', 'paused'].includes(pendingRun.rows[0].status)) {
        return {
          status: 'ready',
          run: pendingRun.rows[0],
          resume: true,
          balance,
          available,
          cutoff,
          desdeId,
          maxPages: effectiveMaxPages,
          expectedArticles,
        };
      }
    }

    const running = await db.query(
      "SELECT id FROM facturapp_sync_runs WHERE status = 'running' ORDER BY id DESC LIMIT 1"
    );
    if (running.rows[0]) {
      return {
        status: 'already_running',
        runId: running.rows[0].id,
        message: 'Ya hay una sincronización en ejecución.',
      };
    }

    let run;
    const conn = await db.getClient();
    try {
      await conn.query('BEGIN');
      const started = await conn.query(
        `INSERT INTO facturapp_sync_runs
          (mode, status, triggered_by, started_at, cutoff, desde_id_inicial, last_desde_id, max_pages, credits_start)
         VALUES ($1, 'running', $2, NOW(), $3, $4, $4, $5, $6)
         RETURNING *`,
        [effectiveMode, trigger, cutoff, desdeId, effectiveMaxPages, balance.disponiblesMes]
      );

      run = started.rows[0];

      await conn.query(
        `UPDATE facturapp_sync_state
         SET pending_mode = $1, pending_cutoff = $2, pending_desde_id = $3,
             pending_run_id = $4, updated_at = NOW()
         WHERE id = 1`,
        [effectiveMode, cutoff, desdeId, run.id]
      );

      await conn.query('COMMIT');
    } catch (txErr) {
      try {
        await conn.query('ROLLBACK');
      } catch (_rollbackErr) {
        // ignore
      }
      throw txErr;
    } finally {
      conn.release();
    }

    return {
      status: 'ready',
      run,
      resume: false,
      balance,
      available,
      cutoff,
      desdeId,
      maxPages: effectiveMaxPages,
      expectedArticles,
    };
  }

  async function acquireLock() {
    const token = `${process.pid}:${Date.now()}`;
    const acquired = await redis.set(LOCK_KEY, token, 'EX', LOCK_TTL_SECONDS, 'NX');
    return acquired ? token : null;
  }

  async function releaseLock() {
    try {
      await redis.del(LOCK_KEY);
    } catch (_err) {
      // best effort
    }
  }

  async function markStaleRuns() {
    try {
      await db.query(
        `UPDATE facturapp_sync_runs
         SET status = 'paused', finished_at = NOW(),
             stop_reason = COALESCE(stop_reason, 'stale_run'),
             last_error = COALESCE(last_error, 'Corrida interrumpida sin cierre'),
             updated_at = NOW()
         WHERE status = 'running' AND started_at < NOW() - ($1 || ' hours')::interval`,
        [String(STALE_RUN_HOURS)]
      );

      // Si la corrida pendiente ya terminó (éxito o fallo), no debe bloquear la próxima.
      await db.query(
        `UPDATE facturapp_sync_state
         SET pending_mode = NULL, pending_cutoff = NULL, pending_desde_id = NULL,
             pending_run_id = NULL, updated_at = NOW()
         WHERE pending_run_id IS NOT NULL
           AND pending_run_id IN (
             SELECT id FROM facturapp_sync_runs
             WHERE status IN ('completed', 'failed', 'cancelled')
           )`
      );
    } catch (_err) {
      // La tabla puede no existir antes de migrar; el caller maneja el error real.
    }
  }

  async function updateRun(runId, values) {
    await db.query(
      `UPDATE facturapp_sync_runs
       SET status = $1, finished_at = $2, last_desde_id = $3, pages_processed = $4,
           articles_received = $5, inserted = $6, updated = $7, unchanged = $8,
           deactivated = $9, credits_start = $10, credits_consumed = $11,
           credits_end = $12, errors = $13, last_error = $14, last_request_id = $15,
           stop_reason = $16, updated_at = NOW()
       WHERE id = $17`,
      [
        values.status,
        values.finishedAt || null,
        values.lastDesdeId ?? null,
        values.pages || 0,
        values.received || 0,
        values.inserted || 0,
        values.updated || 0,
        values.unchanged || 0,
        values.deactivated || 0,
        values.creditsStart ?? null,
        values.creditsConsumed || 0,
        values.creditsEnd ?? null,
        values.errors || 0,
        values.lastError || null,
        values.lastRequestId || null,
        values.stopReason || null,
        runId,
      ]
    );
  }

  async function savePendingState({ mode, cutoff, desdeId, runId }) {
    await db.query(
      `UPDATE facturapp_sync_state
       SET pending_mode = $1, pending_cutoff = $2, pending_desde_id = $3,
           pending_run_id = $4, updated_at = NOW()
       WHERE id = 1`,
      [mode, cutoff, desdeId, runId]
    );
  }

  async function clearPendingState(cutoff) {
    await db.query(
      `UPDATE facturapp_sync_state
       SET last_success_at = NOW(), last_cutoff = $1,
           pending_mode = NULL, pending_cutoff = NULL,
           pending_desde_id = NULL, pending_run_id = NULL,
           updated_at = NOW()
       WHERE id = 1`,
      [cutoff]
    );
  }

  async function upsertArticle(conn, article) {
    const mapped = mapArticle(article);

    const existing = await conn.query(
      'SELECT id, facturapp_id, contenido_hash FROM productos WHERE sku = $1 FOR UPDATE',
      [mapped.sku]
    );

    if (existing.rows[0]) {
      const row = existing.rows[0];
      const existingFacturappId = row.facturapp_id === null ? null : Number(row.facturapp_id);

      if (existingFacturappId === null) {
        // Producto preexistente (Kroser/otro): se adopta como el mismo artículo.
        try {
          await conn.query('UPDATE productos SET facturapp_id = $1 WHERE id = $2', [
            mapped.facturappId,
            row.id,
          ]);
        } catch (claimErr) {
          if (claimErr.code === '23505') {
            // Otro producto ya usa este facturapp_id: no adoptar, usar SKU alternativo.
            mapped.sku = `${mapped.sku}#${mapped.facturappId}`.slice(0, 100);
            logger.warn('[Facturapp] No se pudo adoptar el SKU existente; se usa SKU alternativo', {
              facturappId: mapped.facturappId,
              sku: mapped.sku,
            });
          } else {
            throw claimErr;
          }
        }
      } else if (existingFacturappId !== mapped.facturappId) {
        // Código duplicado entre dos artículos distintos: no pisar el otro.
        const fallback = `${mapped.sku}#${mapped.facturappId}`.slice(0, 100);
        logger.warn('[Facturapp] Código duplicado con otro artículo; se usa SKU alternativo', {
          facturappId: mapped.facturappId,
          sku: mapped.sku,
          fallback,
        });
        mapped.sku = fallback;
      } else if (row.contenido_hash === mapped.contenidoHash) {
        return { outcome: 'unchanged', deactivated: false };
      }
    }

    const params = [
      mapped.facturappId,
      mapped.sku,
      mapped.nombre,
      mapped.precio,
      mapped.precioCosto,
      mapped.moneda,
      mapped.descripcion,
      mapped.stockStatus,
      mapped.stock,
      mapped.stockMinimo,
      mapped.unidadMedida,
      mapped.iva,
      mapped.discontinuado,
      mapped.codigoOriginal,
      mapped.codigoBarras,
      mapped.activo,
      mapped.fechaUpdate,
      mapped.idRamo,
      mapped.idFamilia,
      mapped.idGrupo,
      mapped.idMarca,
      mapped.idProveedor,
      JSON.stringify(article),
      mapped.contenidoHash,
      null, // categoria (se conserva si ya existe)
      null, // marca
      null, // imagen_url
      null, // producto_url
    ];

    let result;
    try {
      result = await conn.query(UPSERT_SQL, params);
    } catch (upsertErr) {
      // Choque de código entre dos artículos: se conserva el facturapp_id y se usa un SKU alternativo.
      if (upsertErr.code === '23505') {
        params[1] = `${mapped.sku}#${mapped.facturappId}`.slice(0, 100);
        logger.warn('[Facturapp] Conflicto de SKU al hacer upsert; se usa SKU alternativo', {
          facturappId: mapped.facturappId,
          sku: params[1],
        });
        result = await conn.query(UPSERT_SQL, params);
      } else {
        throw upsertErr;
      }
    }

    return {
      outcome: result.rows[0]?.is_inserted ? 'inserted' : 'updated',
      deactivated: mapped.discontinuado === true,
    };
  }

  async function upsertPage(articles) {
    const conn = await db.getClient();
    const stats = { inserted: 0, updated: 0, unchanged: 0, deactivated: 0 };
    try {
      await conn.query('BEGIN');
      for (const article of articles) {
        const res = await upsertArticle(conn, article);
        stats[res.outcome] += 1;
        if (res.deactivated) stats.deactivated += 1;
      }
      await conn.query('COMMIT');
      return stats;
    } catch (err) {
      try {
        await conn.query('ROLLBACK');
      } catch (_rollbackErr) {
        // ignore
      }
      throw err;
    } finally {
      conn.release();
    }
  }

  async function executeRun(prepared, lockToken) {
    const run = prepared.run;
    const startedAt = clock();
    const counters = {
      status: 'running',
      finishedAt: null,
      lastDesdeId: prepared.desdeId,
      pages: Number(run.pages_processed) || 0,
      received: Number(run.articles_received) || 0,
      inserted: Number(run.inserted) || 0,
      updated: Number(run.updated) || 0,
      unchanged: Number(run.unchanged) || 0,
      deactivated: Number(run.deactivated) || 0,
      creditsStart: Number(run.credits_start ?? prepared.balance.disponiblesMes),
      creditsConsumed: Number(run.credits_consumed) || 0,
      creditsEnd: prepared.balance.disponiblesMes,
      errors: Number(run.errors) || 0,
      lastError: null,
      lastRequestId: null,
      stopReason: null,
    };

    let desdeId = Number(prepared.desdeId) || 0;
    const cutoff = prepared.cutoff || null;
    const maxPages = Number(prepared.maxPages) || config.maxPages;
    let creditsAvailable = prepared.balance.disponiblesMes;
    let completed = false;

    logger.info('[Facturapp] Inicio de sincronización', {
      runId: run.id,
      mode: run.mode,
      cutoff,
      desdeId,
      maxPages,
      creditsAvailable,
      reserveCredits: config.reserveCredits,
    });

    try {
      for (;;) {
        if (counters.pages >= maxPages) {
          counters.stopReason = 'max_pages';
          break;
        }

        if (creditsAvailable - config.reserveCredits < 1) {
          counters.stopReason = 'insufficient_credits';
          break;
        }

        let page;
        try {
          page = await api.listArticles({
            desdeId,
            cantidad: PAGE_SIZE,
            soloActivos: false,
            modificadosDesde: cutoff || undefined,
          });
        } catch (err) {
          counters.errors += 1;
          counters.lastError = err.message;
          counters.lastRequestId = err.requestId || null;
          counters.status = err.retryable ? 'paused' : 'failed';
          counters.stopReason = err.retryable ? 'retryable_error' : 'fatal_error';
          await updateRun(run.id, { ...counters, finishedAt: new Date() });
          await savePendingState({ mode: run.mode, cutoff, desdeId, runId: run.id });
          logger.error('[Facturapp] Error al listar artículos', {
            runId: run.id,
            status: err.status || null,
            code: err.code || null,
            requestId: counters.lastRequestId,
            error: err.message,
          });
          return { ...counters, runId: run.id, mode: run.mode, cutoff, completed: false };
        }

        const rows = Array.isArray(page.articles) ? page.articles : [];
        const creditsAfter = page.creditos?.disponiblesMes;
        counters.creditsConsumed += 1;
        if (Number.isFinite(Number(creditsAfter))) {
          creditsAvailable = Number(creditsAfter);
        } else {
          creditsAvailable -= 1;
        }
        counters.creditsEnd = creditsAvailable;

        if (rows.length === 0) {
          completed = true;
          break;
        }

        const deduped = dedupeArticles(rows);
        const stats = await upsertPage(deduped);

        counters.pages += 1;
        counters.received += rows.length;
        counters.inserted += stats.inserted;
        counters.updated += stats.updated;
        counters.unchanged += stats.unchanged;
        counters.deactivated += stats.deactivated;

        const next = page.siguienteDesdeId;
        await updateRun(run.id, { ...counters, lastDesdeId: next ?? desdeId });
        await savePendingState({ mode: run.mode, cutoff, desdeId: next ?? desdeId, runId: run.id });

        logger.info('[Facturapp] Página procesada', {
          runId: run.id,
          pages: counters.pages,
          received: counters.received,
          inserted: counters.inserted,
          updated: counters.updated,
          unchanged: counters.unchanged,
          creditsAvailable,
          nextDesdeId: next,
        });

        if (next === null || next === undefined) {
          completed = true;
          break;
        }

        if (Number(next) <= desdeId) {
          counters.status = 'failed';
          counters.stopReason = 'pagination_stalled';
          counters.lastError = `siguienteDesdeId (${next}) no avanzó respecto de ${desdeId}`;
          await updateRun(run.id, { ...counters, finishedAt: new Date() });
          await savePendingState({ mode: run.mode, cutoff, desdeId, runId: run.id });
          return { ...counters, runId: run.id, mode: run.mode, cutoff, completed: false };
        }

        desdeId = Number(next);
      }

      if (completed) {
        counters.status = 'completed';
        counters.finishedAt = new Date();
        counters.stopReason = 'completed';
        await updateRun(run.id, counters);
        await clearPendingState(cutoff || startedAt.toISOString());

        if (String(env.NODE_ENV || '') !== 'test' && String(env.FACTURAPP_SYNC_EMBEDDINGS || 'true') !== 'false') {
          try {
            const embeddings = require('../embeddings/generateEmbeddings');
            if (embeddings && typeof embeddings.processIncrementalEmbeddings === 'function') {
              await embeddings.processIncrementalEmbeddings();
            }
          } catch (embErr) {
            logger.warn('[Facturapp] No se pudieron actualizar embeddings', { error: embErr.message });
          }
        }
      } else {
        counters.status = 'paused';
        counters.finishedAt = new Date();
        await updateRun(run.id, counters);
        await savePendingState({ mode: run.mode, cutoff, desdeId, runId: run.id });
      }

      logger.info('[Facturapp] Sincronización finalizada', {
        runId: run.id,
        status: counters.status,
        stopReason: counters.stopReason,
        pages: counters.pages,
        received: counters.received,
        inserted: counters.inserted,
        updated: counters.updated,
        unchanged: counters.unchanged,
        creditsConsumed: counters.creditsConsumed,
        creditsEnd: counters.creditsEnd,
      });

      return { ...counters, runId: run.id, mode: run.mode, cutoff, completed };
    } catch (err) {
      counters.status = 'failed';
      counters.finishedAt = new Date();
      counters.lastError = err.message;
      counters.stopReason = 'unexpected_error';
      logger.error('[Facturapp] Error inesperado durante la sincronización', {
        runId: run.id,
        error: err.message,
      });
      try {
        await updateRun(run.id, counters);
        await savePendingState({ mode: run.mode, cutoff, desdeId, runId: run.id });
      } catch (_persistErr) {
        // El lock se libera igualmente; la corrida quedará como stale para recuperación.
      }
      return { ...counters, runId: run.id, mode: run.mode, cutoff, completed: false };
    } finally {
      if (lockToken) await releaseLock();
    }
  }

  async function startSync(options = {}) {
    await markStaleRuns();

    // El lock se toma antes de crear la corrida para no dejar filas 'running' huérfanas.
    const lockToken = await acquireLock();
    if (!lockToken) {
      return {
        status: 'already_running',
        message: 'Otra sincronización está en ejecución.',
      };
    }

    let prepared;
    try {
      prepared = await prepareRun(options);
    } catch (err) {
      await releaseLock();
      throw err;
    }

    if (prepared.status !== 'ready') {
      await releaseLock();
      return prepared;
    }

    const background = executeRun(prepared, lockToken).catch((err) => {
      logger.error('[Facturapp] Error no controlado en sincronización', {
        runId: prepared.run.id,
        error: err.message,
      });
      return { status: 'failed', runId: prepared.run.id, lastError: err.message };
    });

    // No bloquear la respuesta HTTP.
    if (options.wait === true) {
      return await background;
    }

    background.catch(() => {});
    return {
      status: 'running',
      runId: prepared.run.id,
      mode: prepared.run.mode,
      cutoff: prepared.cutoff,
      resume: prepared.resume,
      maxPages: prepared.maxPages,
      creditsAvailable: prepared.available,
    };
  }

  async function runSync(options = {}) {
    return startSync({ ...options, wait: true });
  }

  return {
    config,
    getState,
    getBalance,
    getStatus,
    getRecentRuns,
    estimate,
    prepareRun,
    startSync,
    runSync,
    _internal: {
      upsertPage,
      upsertArticle,
      updateRun,
      clearPendingState,
    },
  };
}

const instance = createFacturappSyncService();
module.exports = instance;
module.exports.createFacturappSyncService = createFacturappSyncService;
module.exports.mapArticle = mapArticle;
module.exports.dedupeArticles = dedupeArticles;
module.exports.computeCutoff = computeCutoff;
module.exports.estimatePages = estimatePages;
module.exports.normalizeCurrency = normalizeCurrency;
module.exports.normalizeDate = normalizeDate;
module.exports.normalizeSku = normalizeSku;
module.exports.PAGE_SIZE = PAGE_SIZE;
module.exports.UPSERT_SQL = UPSERT_SQL;
