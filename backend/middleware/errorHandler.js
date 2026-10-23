const logger = require('../config/logger');

module.exports = function errorHandler(err, req, res, _next) {
  logger.error('[Unhandled Error]', { error: err.message, stack: err.stack });

  const statusCode = err.statusCode || (typeof err.status === 'number' ? err.status : 500);
  const isProduction = process.env.NODE_ENV === 'production';
  const message = isProduction && statusCode >= 500
    ? 'Error interno del servidor'
    : (err.message || 'Error interno del servidor');

  res.status(statusCode).json({
    error: message,
    timestamp: new Date().toISOString(),
  });
};
