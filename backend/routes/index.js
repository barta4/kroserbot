const express = require('express');
const router = express.Router();

const healthRoutes = require('./healthRoutes');
const authRoutes = require('./authRoutes');
const analyticsRoutes = require('./analyticsRoutes');
const productosRoutes = require('./productosRoutes');
const localesRoutes = require('./localesRoutes');
const webhookRoutes = require('./webhookRoutes');
const pedidosRoutes = require('./pedidosRoutes');
const configuracionRoutes = require('./configuracionRoutes');
const llmRoutes = require('./llmRoutes');
const scraperRoutes = require('./scraperRoutes');
const zonasEnvioRoutes = require('./zonasEnvioRoutes');
const formasPagoRoutes = require('./formasPagoRoutes');
const mercadopagoRoutes = require('./mercadopagoRoutes');
const chatwootRoutes = require('./chatwootRoutes');
const simulatorRoutes = require('./simulatorRoutes');
const guiasTecnicasRoutes = require('./guiasTecnicasRoutes');

router.use('/', healthRoutes);
router.use('/auth', authRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/productos', productosRoutes);
router.use('/locales', localesRoutes);
router.use('/webhook', webhookRoutes);
router.use('/pedidos', pedidosRoutes);
router.use('/configuracion', configuracionRoutes);
router.use('/llm', llmRoutes);
router.use('/scraper', scraperRoutes);
router.use('/zonas-envio', zonasEnvioRoutes);
router.use('/formas-pago', formasPagoRoutes);
router.use('/mercadopago', mercadopagoRoutes);
router.use('/chatwoot', chatwootRoutes);
router.use('/simulator', simulatorRoutes);
router.use('/guias-tecnicas', guiasTecnicasRoutes);

module.exports = router;

