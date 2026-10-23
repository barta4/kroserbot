/**
 * Programador diario de la sincronización incremental de Facturapp.
 *
 * Se ejecuta una vez por día a la hora configurada (hora Uruguay, UTC-3).
 * No fuerza dos corridas: si el día ya tuvo una sincronización exitosa, no hace nada.
 * Se activa con FACTURAPP_SYNC_ENABLED=true.
 */
const logger = require('../../config/logger');

const URUGUAY_OFFSET_MS = -3 * 60 * 60 * 1000;
const TICK_MS = 60 * 1000;

function startFacturappScheduler(overrides = {}) {
  const env = overrides.env || process.env;
  const log = overrides.logger || logger;
  const service = overrides.service || require('./facturappSyncService');
  const now = overrides.now || (() => new Date());

  if (String(env.NODE_ENV || '') === 'test') return null;
  if (String(env.FACTURAPP_SYNC_ENABLED || 'false') !== 'true') {
    log.info('[Facturapp] Scheduler deshabilitado (FACTURAPP_SYNC_ENABLED != true)');
    return null;
  }

  const hour = Math.min(Math.max(parseInt(env.FACTURAPP_SYNC_HOUR || '4', 10) || 4, 0), 23);
  const minute = Math.min(Math.max(parseInt(env.FACTURAPP_SYNC_MINUTE || '0', 10) || 0, 0), 59);

  let ticking = false;
  let lastAttemptDay = null;
  let timer = null;

  function uruguayParts(date) {
    const shifted = new Date(date.getTime() + URUGUAY_OFFSET_MS);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth(),
      day: shifted.getUTCDate(),
      dayKey: shifted.toISOString().slice(0, 10),
    };
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const current = now();
      const parts = uruguayParts(current);
      // Medianoche de hoy en Uruguay expresada en UTC.
      const scheduledToday = new Date(
        Date.UTC(parts.year, parts.month, parts.day, hour - 3, minute, 0, 0)
      );

      if (current < scheduledToday) return;
      if (lastAttemptDay === parts.dayKey) return;

      const state = await service.getState();
      const lastSuccess = state?.last_success_at ? new Date(state.last_success_at) : null;
      if (lastSuccess && lastSuccess >= scheduledToday) {
        lastAttemptDay = parts.dayKey;
        return;
      }

      lastAttemptDay = parts.dayKey;
      log.info('[Facturapp] Disparando sincronización incremental programada', {
        scheduledToday: scheduledToday.toISOString(),
        lastSuccessAt: lastSuccess ? lastSuccess.toISOString() : null,
      });

      const result = await service.runSync({ mode: 'incremental', trigger: 'scheduler' });
      if (result?.status === 'initial_required') {
        log.warn('[Facturapp] Scheduler omitido: falta la sincronización inicial', result);
      } else {
        log.info('[Facturapp] Resultado de la sincronización programada', {
          status: result?.status,
          runId: result?.runId,
          pages: result?.pages,
          received: result?.received,
          inserted: result?.inserted,
          updated: result?.updated,
          creditsConsumed: result?.creditsConsumed,
          stopReason: result?.stopReason,
        });
      }
    } catch (err) {
      log.error('[Facturapp] Error en el scheduler diario', { error: err.message });
    } finally {
      ticking = false;
    }
  }

  timer = setInterval(() => {
    tick();
  }, TICK_MS);
  if (timer.unref) timer.unref();

  // Chequeo inicial para recuperar la corrida del día si el proceso arrancó tarde.
  setImmediate(() => tick());

  log.info('[Facturapp] Scheduler diario activo', { hour, minute, timezone: 'America/Montevideo (UTC-3)' });
  return timer;
}

function stopFacturappScheduler(timer) {
  if (timer) clearInterval(timer);
}

module.exports = { startFacturappScheduler, stopFacturappScheduler };
