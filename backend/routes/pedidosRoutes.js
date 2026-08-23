const express = require('express');
const router = express.Router();
const pedidosController = require('../controllers/pedidosController');
const { requireRole } = require('../middleware/requireAuth');

router.post('/', requireRole('admin', 'deposito'), pedidosController.createPedido);
router.get('/', requireRole('admin', 'deposito'), pedidosController.listPedidos);
router.get('/:id', requireRole('admin', 'deposito'), pedidosController.getPedidoById);
router.put('/:id/estado', requireRole('admin', 'deposito'), pedidosController.updateEstado);
router.put('/:id', requireRole('admin', 'deposito'), pedidosController.updatePedido);

module.exports = router;
