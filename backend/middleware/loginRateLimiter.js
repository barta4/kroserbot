const rateLimit = require('express-rate-limit');

const isTest = process.env.NODE_ENV === 'test';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 1000 : 5,
  skip: () => isTest,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de login. Por favor reintente más tarde.' },
});

module.exports = loginLimiter;
