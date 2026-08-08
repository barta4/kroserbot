const express = require('express');
const router = express.Router();
const scraperController = require('../controllers/scraperController');

router.post('/start', scraperController.startScraper);
router.post('/stop', scraperController.stopScraper);
router.get('/status', scraperController.getScraperStatus);

module.exports = router;
