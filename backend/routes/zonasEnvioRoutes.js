const express = require('express');
const router = express.Router();
const zonasEnvioController = require('../controllers/zonasEnvioController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

router.get('/', requireAuth, zonasEnvioController.listZonas);
router.post('/', requireRole('admin'), zonasEnvioController.createZona);
router.put('/:id', requireRole('admin'), zonasEnvioController.updateZona);
router.delete('/:id', requireRole('admin'), zonasEnvioController.deleteZona);

module.exports = router;
