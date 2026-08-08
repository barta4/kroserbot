module.exports = function errorHandler(err, req, res, _next) {
  console.error('[Unhandled Error]', err.stack || err.message || err);

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Error interno del servidor';

  res.status(statusCode).json({
    error: message,
    timestamp: new Date().toISOString(),
  });
};
