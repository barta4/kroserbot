const express = require('express');
const router = express.Router();

const healthRoutes = require('./healthRoutes');
const webhookRoutes = require('./webhookRoutes');
const pedidosRoutes = require('./pedidosRoutes');
const configuracionRoutes = require('./configuracionRoutes');
const scraperRoutes = require('./scraperRoutes');

router.use('/', healthRoutes);
router.use('/webhook', webhookRoutes);
router.use('/pedidos', pedidosRoutes);
router.use('/configuracion', configuracionRoutes);
router.use('/scraper', scraperRoutes);

module.exports = router;
