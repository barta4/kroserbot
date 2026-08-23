const express = require('express');
const router = express.Router();
const simulatorController = require('../controllers/simulatorController');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

// POST /api/simulator/chat - Test conversation sandbox
router.post('/chat', requireAuth, requireRole('admin'), simulatorController.simulateMessage);

module.exports = router;
