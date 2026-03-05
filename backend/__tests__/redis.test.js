/**
 * Unit tests for redis service — graceful degradation
 */

describe("redis service", () => {
  const originalEnv = process.env.REDIS_HOST;

  afterEach(() => {
    if (originalEnv) {
      process.env.REDIS_HOST = originalEnv;
    } else {
      delete process.env.REDIS_HOST;
    }
    jest.resetModules();
  });

  test("isAvailable returns false when REDIS_HOST not set", () => {
    delete process.env.REDIS_HOST;
    jest.resetModules();

    // Mock ioredis to prevent actual connection
    jest.doMock("ioredis", () => {
      return jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        connect: jest.fn().mockResolvedValue(),
      }));
    });

    const { isAvailable } = require("../services/redis");
    expect(isAvailable()).toBe(false);
  });

  test("exports redis as null when REDIS_HOST not set", () => {
    delete process.env.REDIS_HOST;
    jest.resetModules();

    jest.doMock("ioredis", () => {
      return jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        connect: jest.fn().mockResolvedValue(),
      }));
    });

    const { redis } = require("../services/redis");
    expect(redis).toBeNull();
  });
});
