const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  validate: {
    xForwardedForHeader: false,
    default: false,
  },
  message: { error: 'Demasiadas solicitudes desde esta IP, por favor reintente más tarde.' },
  skip: (req) => {
    // Exclude webhooks from generic API rate limiter (have signature/Basic Auth + deduplication)
    const pathname = (req.originalUrl || req.url || '').split('?')[0].replace(/\/$/, '');
    return (
      pathname === '/api/webhook' ||
      pathname === '/webhook' ||
      pathname === '/api/mercadopago/webhook' ||
      req.path === '/webhook' ||
      req.path === '/mercadopago/webhook'
    );
  },
});

module.exports = apiLimiter;
