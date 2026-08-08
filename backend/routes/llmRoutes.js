const express = require('express');
const router = express.Router();
const llmController = require('../controllers/llmController');

router.get('/models', llmController.getModels);
router.post('/config', llmController.saveConfig);

module.exports = router;
