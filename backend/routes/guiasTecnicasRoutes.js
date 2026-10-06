const express = require('express');
const router = express.Router();
const guiasController = require('../controllers/guiasTecnicasController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

// Authenticated routes for listing technical guides
router.get('/', requireAuth, guiasController.listGuias);
router.get('/:id', requireAuth, guiasController.getGuia);

// Admin-only protected routes for modifying technical guides
router.post('/', requireRole('admin'), guiasController.createGuia);
router.put('/:id', requireRole('admin'), guiasController.updateGuia);
router.delete('/:id', requireRole('admin'), guiasController.deleteGuia);

module.exports = router;
