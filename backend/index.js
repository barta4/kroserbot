const express = require('express');
require('dotenv').config();

const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const apiLimiter = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// HTTP Security Headers (Helmet)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrcAttr: ["'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  },
  frameguard: { action: 'deny' },
}));

const allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length > 0 ? allowedOrigins : false,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
}));

app.use(cookieParser());

// Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static admin files
app.use('/admin', express.static(path.join(__dirname, '../admin')));

// Friendly root and dashboard redirects
app.get('/', (req, res) => {
  res.redirect('/admin/');
});

app.get('/deposito', (req, res) => {
  res.redirect('/admin/deposito.html');
});

// Apply rate limiting & Mount main API routes (all endpoints live under /api)
app.use('/api', apiLimiter, routes);

// Centralized error handling middleware
app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[Bot Kroser Backend] Server running on port ${PORT} (env: ${process.env.NODE_ENV || 'development'})`);
  });
}

module.exports = app;
