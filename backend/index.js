const express = require('express');
require('dotenv').config();

const apiLimiter = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const routes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Apply rate limiting
app.use('/api', apiLimiter);

// Mount main API routes
app.use('/', routes);

// Centralized error handling middleware
app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[Bot Kroser Backend] Server running on port ${PORT} (env: ${process.env.NODE_ENV || 'development'})`);
  });
}

module.exports = app;
