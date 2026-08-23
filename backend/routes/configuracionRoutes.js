const express = require('express');
const router = express.Router();
const configuracionController = require('../controllers/configuracionController');
const { requireRole } = require('../middleware/requireAuth');

router.get('/', requireRole('admin'), configuracionController.getConfig);
router.put('/', requireRole('admin'), configuracionController.updateConfig);
router.get('/history', requireRole('admin'), configuracionController.getHistory);

module.exports = router;
