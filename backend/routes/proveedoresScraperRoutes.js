const express = require('express');
const router = express.Router();
const controller = require('../controllers/proveedoresScraperController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

router.get('/', requireAuth, requireRole('admin'), controller.getProveedores);
router.put('/:codigo', requireAuth, requireRole('admin'), controller.updateProveedor);
router.post('/:codigo/recalcular-precios', requireAuth, requireRole('admin'), controller.recalcularPrecios);
router.post('/:codigo/sync', requireAuth, requireRole('admin'), controller.syncProveedor);
router.post('/recalcular-todos', requireAuth, requireRole('admin'), controller.recalcularTodos);

module.exports = router;

