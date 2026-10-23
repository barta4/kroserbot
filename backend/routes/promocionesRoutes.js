const express = require('express');
const router = express.Router();
const controller = require('../controllers/promocionesController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

// Public route to fetch currently active promotions for Cotibot / Landing
router.get('/', controller.getActivePromociones);

// Admin routes for managing special promotions
router.get('/all', requireAuth, requireRole('admin'), controller.getAllPromociones);
router.post('/', requireAuth, requireRole('admin'), controller.createPromocion);
router.put('/:id', requireAuth, requireRole('admin'), controller.updatePromocion);
router.patch('/:id/toggle', requireAuth, requireRole('admin'), controller.togglePromocion);
router.delete('/:id', requireAuth, requireRole('admin'), controller.deletePromocion);

module.exports = router;
