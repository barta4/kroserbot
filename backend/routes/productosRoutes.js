const express = require('express');
const router = express.Router();
const productosController = require('../controllers/productosController');
const { requireRole } = require('../middleware/requireAuth');
const { optionalClienteAuth } = require('../middleware/clienteAuth');

// Lectura de catálogo disponible para landing pública y clientes registrados (con cálculo de descuentos)
router.get('/', optionalClienteAuth, productosController.listProductos);
router.get('/categorias', productosController.getCategorias);
router.get('/:id', optionalClienteAuth, productosController.getProducto);

// Borrado reservado exclusivamente para administradores
router.delete('/:id', requireRole('admin'), productosController.deleteProducto);

module.exports = router;
