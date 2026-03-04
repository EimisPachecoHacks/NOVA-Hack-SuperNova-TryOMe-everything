/**
 * Lightweight structured logger wrapping console methods.
 * Adds ISO timestamps and log levels. Drop-in replacement for console.log/warn/error.
 *
 * Usage:
 *   const log = require("../utils/logger");
 *   log.info("Server started", { port: 3000 });
 *   log.warn("Slow response", { ms: 4200 });
 *   log.error("Failed to connect", err);
 */

function formatMessage(level, msg, meta) {
  const ts = new Date().toISOString();
  const base = `[${ts}] [${level}] ${msg}`;
  if (meta !== undefined) {
    const detail = meta instanceof Error ? meta.message : (typeof meta === "object" ? JSON.stringify(meta) : String(meta));
    return `${base} ${detail}`;
  }
  return base;
}

const logger = {
  info(msg, meta) {
    console.log(formatMessage("INFO", msg, meta));
  },
  warn(msg, meta) {
    console.warn(formatMessage("WARN", msg, meta));
  },
  error(msg, meta) {
    console.error(formatMessage("ERROR", msg, meta));
  },
  debug(msg, meta) {
    if (process.env.LOG_LEVEL === "debug") {
      console.log(formatMessage("DEBUG", msg, meta));
    }
  },
};

module.exports = logger;
