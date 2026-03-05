/**
 * Unit tests for utils/logger
 */
const logger = require("../utils/logger");

describe("logger", () => {
  let consoleSpy;

  beforeEach(() => {
    consoleSpy = {
      log: jest.spyOn(console, "log").mockImplementation(),
      warn: jest.spyOn(console, "warn").mockImplementation(),
      error: jest.spyOn(console, "error").mockImplementation(),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("info logs with INFO level and timestamp", () => {
    logger.info("Server started");
    expect(consoleSpy.log).toHaveBeenCalledTimes(1);
    const msg = consoleSpy.log.mock.calls[0][0];
    expect(msg).toMatch(/\[INFO\]/);
    expect(msg).toContain("Server started");
    expect(msg).toMatch(/\d{4}-\d{2}-\d{2}T/); // ISO timestamp
  });

  test("warn logs with WARN level", () => {
    logger.warn("Slow response");
    expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
    expect(consoleSpy.warn.mock.calls[0][0]).toMatch(/\[WARN\]/);
  });

  test("error logs with ERROR level", () => {
    logger.error("Connection failed");
    expect(consoleSpy.error).toHaveBeenCalledTimes(1);
    expect(consoleSpy.error.mock.calls[0][0]).toMatch(/\[ERROR\]/);
  });

  test("info with object meta serializes as JSON", () => {
    logger.info("Request", { method: "GET", path: "/api" });
    const msg = consoleSpy.log.mock.calls[0][0];
    expect(msg).toContain('"method":"GET"');
  });

  test("error with Error meta extracts message", () => {
    logger.error("Failure", new Error("timeout"));
    const msg = consoleSpy.error.mock.calls[0][0];
    expect(msg).toContain("timeout");
  });

  test("debug logs only when LOG_LEVEL=debug", () => {
    const original = process.env.LOG_LEVEL;
    process.env.LOG_LEVEL = "debug";
    logger.debug("Debug info");
    expect(consoleSpy.log).toHaveBeenCalledTimes(1);
    expect(consoleSpy.log.mock.calls[0][0]).toMatch(/\[DEBUG\]/);
    process.env.LOG_LEVEL = original;
  });

  test("debug does not log when LOG_LEVEL is not debug", () => {
    delete process.env.LOG_LEVEL;
    logger.debug("Should not appear");
    expect(consoleSpy.log).not.toHaveBeenCalled();
  });
});
