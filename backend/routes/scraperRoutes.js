const express = require('express');
const router = express.Router();
const scraperController = require('../controllers/scraperController');
const { requireRole } = require('../middleware/requireAuth');

router.post('/start', requireRole('admin'), scraperController.startScraper);
router.post('/stop', requireRole('admin'), scraperController.stopScraper);
router.get('/status', requireRole('admin'), scraperController.getScraperStatus);

module.exports = router;
