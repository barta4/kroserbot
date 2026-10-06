const express = require('express');
const router = express.Router();
const scraperController = require('../controllers/scraperController');
const { requireRole } = require('../middleware/requireAuth');

router.post('/start', requireRole('admin'), scraperController.startScraper);
router.post('/stop', requireRole('admin'), scraperController.stopScraper);
router.get('/status', requireRole('admin'), scraperController.getScraperStatus);
router.get('/embeddings/status', requireRole('admin'), scraperController.getEmbeddingsStatus);
router.post('/embeddings/generate', requireRole('admin'), scraperController.triggerEmbeddingsGeneration);

module.exports = router;
