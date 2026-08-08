require('dotenv').config();

let redisClient = null;
const memoryStore = new Map();

try {
  const Redis = require('ioredis');
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  redisClient = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy(times) {
      if (times > 2) {
        return null; // Stop reconnecting, fallback to memory
      }
      return Math.min(times * 100, 1000);
    },
    lazyConnect: true,
  });

  // Catch ioredis connection error event to prevent unhandled exception
  redisClient.on('error', (err) => {
    // Silent catch when Redis is offline
  });

  redisClient.connect().catch((_err) => {
    redisClient = null;
  });
} catch (_err) {
  redisClient = null;
}

module.exports = {
  async get(key) {
    if (redisClient && redisClient.status === 'ready') {
      try {
        return await redisClient.get(key);
      } catch (_err) {}
    }
    return memoryStore.get(key) || null;
  },

  async set(key, value, mode, durationSeconds) {
    if (redisClient && redisClient.status === 'ready') {
      try {
        if (mode === 'EX' && durationSeconds) {
          return await redisClient.set(key, value, 'EX', durationSeconds);
        }
        return await redisClient.set(key, value);
      } catch (_err) {}
    }
    memoryStore.set(key, value);
    if (mode === 'EX' && durationSeconds) {
      setTimeout(() => memoryStore.delete(key), durationSeconds * 1000);
    }
    return 'OK';
  },

  async del(key) {
    if (redisClient && redisClient.status === 'ready') {
      try {
        return await redisClient.del(key);
      } catch (_err) {}
    }
    memoryStore.delete(key);
    return 1;
  },

  isReady() {
    return redisClient && redisClient.status === 'ready';
  },
};
