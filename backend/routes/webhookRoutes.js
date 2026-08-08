const express = require('express');
const router = express.Router();
const webhookController = require('../controllers/webhookController');
const basicAuth = require('../middleware/auth');
const validateWebhook = require('../middleware/validateWebhook');

router.post('/', basicAuth, validateWebhook, webhookController.handleWebhook);

module.exports = router;
