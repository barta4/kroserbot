const facturappSync = require('../services/facturapp/facturappSyncService');
const logger = require('../config/logger');

function parseMode(value) {
  return value === 'initial' ? 'initial' : 'incremental';
}

module.exports = {
  /**
   * GET /api/facturapp/status
   * Saldo (consulta gratuita), estado persistido y últimas corridas.
   */
  async getStatus(req, res, next) {
    try {
      const status = await facturappSync.getStatus();
      res.json(status);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/facturapp/estimate?mode=initial|incremental
   * Calcula páginas/costo antes de consumir créditos.
   */
  async getEstimate(req, res, next) {
    try {
      const mode = parseMode(req.query.mode);
      const estimate = await facturappSync.estimate({ mode });
      res.json(estimate);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/facturapp/sync
   * Body: { mode, confirmInitial, maxPages, dryRun }
   */
  async startSync(req, res, next) {
    try {
      const body = req.body || {};
      const mode = parseMode(body.mode);
      const dryRun = body.dryRun === true;
      const confirmInitial = body.confirmInitial === true;
      const maxPages = body.maxPages !== undefined ? parseInt(body.maxPages, 10) : undefined;

      if (maxPages !== undefined && (!Number.isFinite(maxPages) || maxPages < 1 || maxPages > 1000)) {
        return res.status(400).json({ error: 'maxPages debe ser un entero entre 1 y 1000' });
      }

      if (dryRun) {
        const estimate = await facturappSync.estimate({ mode });
        return res.json({ dryRun: true, ...estimate });
      }

      const result = await facturappSync.startSync({
        mode,
        confirmInitial,
        maxPages,
        trigger: req.user?.username ? `manual:${req.user.username}` : 'manual',
      });

      if (result.status === 'invalid_mode') {
        return res.status(400).json(result);
      }
      if (['confirmation_required', 'insufficient_credits', 'initial_required', 'already_running'].includes(result.status)) {
        return res.status(409).json(result);
      }
      if (result.status !== 'running') {
        return res.status(502).json(result);
      }

      logger.info('[Facturapp] Sincronización manual iniciada', {
        runId: result.runId,
        mode: result.mode,
        user: req.user?.username || null,
      });

      return res.status(202).json({
        message: 'Sincronización iniciada en segundo plano',
        ...result,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/facturapp/runs?limit=20
   */
  async getRuns(req, res, next) {
    try {
      const runs = await facturappSync.getRecentRuns(req.query.limit);
      res.json({ runs });
    } catch (err) {
      next(err);
    }
  },
};
