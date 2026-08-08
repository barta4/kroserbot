const express = require('express');
const router = express.Router();
const db = require('../config/db');
const redis = require('../config/redis');

router.get('/health', async (req, res) => {
  let dbStatus = 'down';
  let redisStatus = 'down';

  try {
    await db.query('SELECT 1');
    dbStatus = 'up';
  } catch (err) {
    dbStatus = `error: ${err.message}`;
  }

  if (redis.isReady()) {
    redisStatus = 'up';
  } else {
    redisStatus = 'memory_fallback';
  }

  const healthy = dbStatus === 'up';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    services: {
      database: dbStatus,
      redis: redisStatus,
    },
  });
});

module.exports = router;
