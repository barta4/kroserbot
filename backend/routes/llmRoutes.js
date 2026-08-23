const express = require('express');
const router = express.Router();
const llmController = require('../controllers/llmController');
const { requireRole } = require('../middleware/requireAuth');

router.post('/models', requireRole('admin'), llmController.getModels);
router.post('/config', requireRole('admin'), llmController.saveConfig);

module.exports = router;
