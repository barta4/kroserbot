const express = require('express');
const router = express.Router();
const formasPagoController = require('../controllers/formasPagoController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

router.get('/', requireAuth, formasPagoController.listFormas);
router.post('/', requireRole('admin'), formasPagoController.createForma);
router.put('/:id', requireRole('admin'), formasPagoController.updateForma);
router.delete('/:id', requireRole('admin'), formasPagoController.deleteForma);

module.exports = router;
