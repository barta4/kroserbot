require('dotenv').config();

let redisClient = null;
const memoryStore = new Map();
const memoryTimers = new Map();

function clearMemoryTimer(key) {
  if (memoryTimers.has(key)) {
    clearTimeout(memoryTimers.get(key));
    memoryTimers.delete(key);
  }
}

function setMemoryTimer(key, seconds) {
  clearMemoryTimer(key);
  const timer = setTimeout(() => {
    memoryStore.delete(key);
    memoryTimers.delete(key);
  }, seconds * 1000);
  if (timer.unref) timer.unref();
  memoryTimers.set(key, timer);
}

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
    clearMemoryTimer(key);
    memoryStore.set(key, value);
    if (mode === 'EX' && durationSeconds) {
      setMemoryTimer(key, durationSeconds);
    }
    return 'OK';
  },

  async del(key) {
    if (redisClient && redisClient.status === 'ready') {
      try {
        return await redisClient.del(key);
      } catch (_err) {}
    }
    clearMemoryTimer(key);
    memoryStore.delete(key);
    return 1;
  },

  async rpush(key, value) {
    if (redisClient && redisClient.status === 'ready') {
      try {
        return await redisClient.rpush(key, value);
      } catch (_err) {}
    }
    const existing = memoryStore.get(key);
    if (existing !== undefined && !Array.isArray(existing)) {
      throw new Error(`WRONGTYPE Operation against a key holding the wrong kind of value for key: ${key}`);
    }
    const arr = existing || [];
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
    if (memoryStore.has(key)) {
      setMemoryTimer(key, seconds);
      return 1;
    }
    return 0;
  },

  async incr(key) {
    if (redisClient && redisClient.status === 'ready') {
      try {
        return await redisClient.incr(key);
      } catch (_err) {}
    }
    const current = parseInt(memoryStore.get(key) || '0', 10);
    const next = current + 1;
    memoryStore.set(key, String(next));
    return next;
  },

  async publish(channel, message) {
    if (redisClient && redisClient.status === 'ready') {
      try {
        return await redisClient.publish(channel, message);
      } catch (_err) {}
    }
    return 0;
  },

  isReady() {
    return redisClient && redisClient.status === 'ready';
  },
};
