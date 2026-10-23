const express = require('express');
const router = express.Router();
const clientesAdminController = require('../controllers/clientesAdminController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');
const { validateBody } = require('../middleware/validateRequest');
const { categoriaCreateSchema, categoriaUpdateSchema, clienteUpdateSchema } = require('../schemas');

// Categorías de descuento dinámicas (deben ir antes de /:id)
router.get('/categorias', clientesAdminController.listCategorias);
router.post('/categorias', requireAuth, requireRole('admin'), validateBody(categoriaCreateSchema), clientesAdminController.createCategoria);
router.put('/categorias/:codigo', requireAuth, requireRole('admin'), validateBody(categoriaUpdateSchema), clientesAdminController.updateCategoria);
router.delete('/categorias/:codigo', requireAuth, requireRole('admin'), clientesAdminController.deleteCategoria);

// Clientes
router.get('/', requireAuth, requireRole('admin'), clientesAdminController.listClientes);
router.get('/:id', requireAuth, requireRole('admin'), clientesAdminController.getCliente);
router.put('/:id', requireAuth, requireRole('admin'), validateBody(clienteUpdateSchema), clientesAdminController.updateCliente);

module.exports = router;
