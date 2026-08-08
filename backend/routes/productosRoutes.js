const express = require('express');
const router = express.Router();
const productosController = require('../controllers/productosController');

router.get('/', productosController.listProductos);
router.delete('/:id', productosController.deleteProducto);

module.exports = router;
