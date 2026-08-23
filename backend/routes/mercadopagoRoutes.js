const express = require('express');
const router = express.Router();
const mercadopagoController = require('../controllers/mercadopagoController');
const { requireRole } = require('../middleware/requireAuth');

const validateMercadopagoSignature = require('../middleware/validateMercadopagoSignature');

// Public: MercadoPago webhook (valida firma HMAC en producción / si hay secret)
router.post('/webhook', validateMercadopagoSignature, mercadopagoController.handleWebhook);

// Admin only: status, toggle, and preference creation
router.get('/status', requireRole('admin'), mercadopagoController.getStatus);
router.post('/toggle', requireRole('admin'), mercadopagoController.toggle);
router.post('/preference', requireRole('admin'), mercadopagoController.createPreference);

module.exports = router;
