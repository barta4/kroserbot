const express = require('express');
const router = express.Router();
const pedidosController = require('../controllers/pedidosController');

router.post('/', pedidosController.createPedido);
router.get('/', pedidosController.listPedidos);
router.get('/:id', pedidosController.getPedidoById);
router.put('/:id/estado', pedidosController.updateEstado);

module.exports = router;
