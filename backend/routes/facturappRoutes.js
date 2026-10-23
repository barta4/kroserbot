const express = require('express');
const router = express.Router();
const controller = require('../controllers/facturappController');
const { requireRole } = require('../middleware/requireAuth');

router.get('/status', requireRole('admin'), controller.getStatus);
router.get('/estimate', requireRole('admin'), controller.getEstimate);
router.get('/runs', requireRole('admin'), controller.getRuns);
router.post('/sync', requireRole('admin'), controller.startSync);

module.exports = router;
