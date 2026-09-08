const path = require('path');
const { spawn } = require('child_process');
const db = require('../config/db');
const redis = require('../config/redis');
const logger = require('../config/logger');

function triggerScraperProcess() {
  try {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const scraperProcess = spawn(pythonCmd, ['-m', 'scraper', '--resume'], {
      detached: true,
      stdio: 'ignore',
      cwd: path.join(__dirname, '../../'),
    });

    scraperProcess.on('error', (err) => {
      logger.warn('Could not launch local python scraper process directly (may run via Docker worker)', {
        error: err.message,
      });
    });

    scraperProcess.unref();
    logger.info('Background python scraper process triggered');
  } catch (err) {
    logger.warn('Failed to spawn scraper process directly', { error: err.message });
  }
}

module.exports = {
  async startScraper(req, res, next) {
    try {
      const activeRes = await db.query(
        "SELECT * FROM scraper_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1"
      );
      if (activeRes.rows.length > 0) {
        return res.status(400).json({
          error: 'Un scraping ya se encuentra en ejecución',
          run: activeRes.rows[0],
        });
      }

      const insertRes = await db.query(
        `INSERT INTO scraper_runs (status, started_at, pagina_actual, productos_nuevos, productos_actualizados, stop_requested)
         VALUES ('running', NOW(), 1, 0, 0, FALSE)
         RETURNING *`
      );

      const run = insertRes.rows[0];

      // Publish start event to Redis for worker containers
      await redis.publish('scraper:start', JSON.stringify({ runId: run.id }));

      // Trigger local python worker
      triggerScraperProcess();

      logger.info('Scraper run initiated from admin panel', { runId: run.id });

      res.status(202).json({
        message: 'Scraping iniciado',
        run,
      });
    } catch (err) {
      next(err);
    }
  },

  async stopScraper(req, res, next) {
    try {
      const updateRes = await db.query(
        `UPDATE scraper_runs 
         SET stop_requested = TRUE, status = 'stopped', finished_at = NOW() 
         WHERE status = 'running' 
         RETURNING *`
      );

      if (updateRes.rows.length === 0) {
        return res.status(404).json({ error: 'No hay corridas de scraping activas para detener' });
      }

      const run = updateRes.rows[0];

      // Publish stop event to Redis
      await redis.publish('scraper:stop', JSON.stringify({ runId: run.id }));

      logger.info('Scraper stop requested from admin panel', { runId: run.id });

      res.json({
        message: 'Solicitud de detención enviada',
        run,
      });
    } catch (err) {
      next(err);
    }
  },

  async getScraperStatus(req, res, next) {
    try {
      const lastRun = await db.query(
        'SELECT * FROM scraper_runs ORDER BY started_at DESC LIMIT 1'
      );

      res.json({
        currentRun: lastRun.rows[0] || null,
      });
    } catch (err) {
      next(err);
    }
  },
};
