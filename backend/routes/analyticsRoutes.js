const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { requireRole } = require('../middleware/requireAuth');

router.get('/dashboard', requireRole('admin'), analyticsController.getDashboardData);

module.exports = router;
