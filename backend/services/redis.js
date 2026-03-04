const Redis = require("ioredis");

let redis = null;
let available = false;

if (process.env.REDIS_HOST) {
  redis = new Redis({
    host: process.env.REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === "true" ? {} : undefined,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
    lazyConnect: true,
  });

  redis.on("connect", () => {
    available = true;
    console.log("[redis] Connected to ElastiCache Redis");
  });

  redis.on("error", (err) => {
    if (available) console.warn(`[redis] Connection lost: ${err.message}`);
    available = false;
  });

  redis.on("close", () => {
    available = false;
  });

  // Attempt initial connection (non-blocking)
  redis.connect().catch((err) => {
    console.warn(`[redis] Could not connect: ${err.message} — caching disabled`);
  });
} else {
  console.log("[redis] REDIS_HOST not set — try-on caching disabled");
}

function isAvailable() {
  return available && redis !== null;
}

module.exports = { redis, isAvailable };
