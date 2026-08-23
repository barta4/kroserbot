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

  async set(key, value, mode, durationSeconds, option) {
    if (redisClient && redisClient.status === 'ready') {
      try {
        if (mode === 'EX' && durationSeconds && option === 'NX') {
          return await redisClient.set(key, value, 'EX', durationSeconds, 'NX');
        }
        if (mode === 'EX' && durationSeconds) {
          return await redisClient.set(key, value, 'EX', durationSeconds);
        }
        return await redisClient.set(key, value);
      } catch (_err) {}
    }
    if (option === 'NX' && memoryStore.has(key)) {
      return null;
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

  async rpush(key, value) {
    if (redisClient && redisClient.status === 'ready') {
      try {
        return await redisClient.rpush(key, value);
      } catch (_err) {}
    }
    const list = memoryStore.get(key) || [];
    if (!Array.isArray(list)) memoryStore.set(key, []);
    const arr = memoryStore.get(key) || [];
    arr.push(value);
    memoryStore.set(key, arr);
    return arr.length;
  },

  async lrange(key, start, stop) {
    if (redisClient && redisClient.status === 'ready') {
      try {
        return await redisClient.lrange(key, start, stop);
      } catch (_err) {}
    }
    const list = memoryStore.get(key) || [];
    if (!Array.isArray(list)) return [];
    if (stop === -1) return list.slice(start);
    return list.slice(start, stop + 1);
  },

  async expire(key, seconds) {
    if (redisClient && redisClient.status === 'ready') {
      try {
        return await redisClient.expire(key, seconds);
      } catch (_err) {}
    }
    setTimeout(() => memoryStore.delete(key), seconds * 1000);
    return 1;
  },

  isReady() {
    return redisClient && redisClient.status === 'ready';
  },
};
