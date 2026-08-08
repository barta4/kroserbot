const db = require('../config/db');

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

      res.status(202).json({
        message: 'Scraping iniciado',
        run: insertRes.rows[0],
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

      res.json({
        message: 'Solicitud de detención enviada',
        run: updateRes.rows[0],
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
