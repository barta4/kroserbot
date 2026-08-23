const express = require('express');
const router = express.Router();
const productosController = require('../controllers/productosController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

router.get('/', requireAuth, productosController.listProductos);
router.delete('/:id', requireRole('admin'), productosController.deleteProducto);

module.exports = router;
