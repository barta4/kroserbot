const express = require('express');
const router = express.Router();
const guiasController = require('../controllers/guiasTecnicasController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

// Public route for listing active technical guides / chat context
router.get('/', guiasController.listGuias);
router.get('/:id', guiasController.getGuia);

// Admin protected routes for modifying technical guides
router.post('/', requireAuth, guiasController.createGuia);
router.put('/:id', requireAuth, guiasController.updateGuia);
router.delete('/:id', requireAuth, guiasController.deleteGuia);

module.exports = router;
