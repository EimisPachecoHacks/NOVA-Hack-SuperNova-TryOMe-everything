/**
 * Unit tests for tryOnCache — cache key building and cache logic
 */

// Mock redis and s3 before requiring tryOnCache
jest.mock("../services/redis", () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
  },
  isAvailable: jest.fn(),
}));

jest.mock("../services/s3", () => ({
  s3Client: { send: jest.fn() },
  S3_USER_BUCKET: "test-bucket",
  PutObjectCommand: jest.fn(),
  fetchPhotoFromS3: jest.fn(),
}));

const { buildCacheKey, buildOutfitCacheKey, getCached, setCached } = require("../services/tryOnCache");
const { redis, isAvailable } = require("../services/redis");
const { fetchPhotoFromS3, s3Client } = require("../services/s3");

describe("buildCacheKey", () => {
  test("returns deterministic key for same inputs", () => {
    const key1 = buildCacheKey("user1", "imageAAA", "UPPER_BODY", "full", 0);
    const key2 = buildCacheKey("user1", "imageAAA", "UPPER_BODY", "full", 0);
    expect(key1).toBe(key2);
  });

  test("returns different key for different user", () => {
    const key1 = buildCacheKey("user1", "imageAAA", "UPPER_BODY", "full", 0);
    const key2 = buildCacheKey("user2", "imageAAA", "UPPER_BODY", "full", 0);
    expect(key1).not.toBe(key2);
  });

  test("returns different key for different garment class", () => {
    const key1 = buildCacheKey("user1", "imageAAA", "UPPER_BODY", "full", 0);
    const key2 = buildCacheKey("user1", "imageAAA", "LOWER_BODY", "full", 0);
    expect(key1).not.toBe(key2);
  });

  test("returns different key for different framing", () => {
    const key1 = buildCacheKey("user1", "imageAAA", "UPPER_BODY", "full", 0);
    const key2 = buildCacheKey("user1", "imageAAA", "UPPER_BODY", "half", 0);
    expect(key1).not.toBe(key2);
  });

  test("returns different key for different poseIndex", () => {
    const key1 = buildCacheKey("user1", "imageAAA", "UPPER_BODY", "full", 0);
    const key2 = buildCacheKey("user1", "imageAAA", "UPPER_BODY", "full", 1);
    expect(key1).not.toBe(key2);
  });

  test("starts with tryon: prefix", () => {
    const key = buildCacheKey("user1", "imageAAA", "UPPER_BODY", "full", 0);
    expect(key).toMatch(/^tryon:/);
  });

  test("handles null userId as anon", () => {
    const key1 = buildCacheKey(null, "imageAAA", "UPPER_BODY", "full", 0);
    const key2 = buildCacheKey(null, "imageAAA", "UPPER_BODY", "full", 0);
    expect(key1).toBe(key2);
    expect(key1).toMatch(/^tryon:/);
  });
});

describe("buildOutfitCacheKey", () => {
  test("returns deterministic key for same garments", () => {
    const garments = [
      { imageBase64: "img1", garmentClass: "UPPER_BODY" },
      { imageBase64: "img2", garmentClass: "LOWER_BODY" },
    ];
    const key1 = buildOutfitCacheKey("user1", garments, "full", 0);
    const key2 = buildOutfitCacheKey("user1", garments, "full", 0);
    expect(key1).toBe(key2);
  });

  test("starts with tryon:outfit: prefix", () => {
    const garments = [{ imageBase64: "img1", garmentClass: "UPPER_BODY" }];
    const key = buildOutfitCacheKey("user1", garments, "full", 0);
    expect(key).toMatch(/^tryon:outfit:/);
  });

  test("different order of garments produces different key", () => {
    const garments1 = [
      { imageBase64: "img1", garmentClass: "UPPER_BODY" },
      { imageBase64: "img2", garmentClass: "LOWER_BODY" },
    ];
    const garments2 = [
      { imageBase64: "img2", garmentClass: "LOWER_BODY" },
      { imageBase64: "img1", garmentClass: "UPPER_BODY" },
    ];
    const key1 = buildOutfitCacheKey("user1", garments1, "full", 0);
    const key2 = buildOutfitCacheKey("user1", garments2, "full", 0);
    expect(key1).not.toBe(key2);
  });
});

describe("getCached", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("returns null when redis is unavailable", async () => {
    isAvailable.mockReturnValue(false);
    const result = await getCached("tryon:abc123");
    expect(result).toBeNull();
    expect(redis.get).not.toHaveBeenCalled();
  });

  test("returns null when key not in redis", async () => {
    isAvailable.mockReturnValue(true);
    redis.get.mockResolvedValue(null);
    const result = await getCached("tryon:abc123");
    expect(result).toBeNull();
  });

  test("fetches from S3 when redis has s3Key", async () => {
    isAvailable.mockReturnValue(true);
    redis.get.mockResolvedValue("cache/user1/abc123.jpg");
    fetchPhotoFromS3.mockResolvedValue("base64imagedata");
    const result = await getCached("tryon:abc123");
    expect(result).toBe("base64imagedata");
    expect(fetchPhotoFromS3).toHaveBeenCalledWith("cache/user1/abc123.jpg");
  });

  test("returns null on redis error", async () => {
    isAvailable.mockReturnValue(true);
    redis.get.mockRejectedValue(new Error("connection lost"));
    const result = await getCached("tryon:abc123");
    expect(result).toBeNull();
  });
});

describe("setCached", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("does nothing when redis is unavailable", async () => {
    isAvailable.mockReturnValue(false);
    await setCached("tryon:abc123", "base64data", "user1");
    expect(s3Client.send).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  test("stores in S3 and sets redis key when available", async () => {
    isAvailable.mockReturnValue(true);
    s3Client.send.mockResolvedValue({});
    redis.set.mockResolvedValue("OK");
    await setCached("tryon:abc123", "base64data", "user1");
    expect(s3Client.send).toHaveBeenCalled();
    expect(redis.set).toHaveBeenCalled();
    // Check redis was called with TTL
    const setCall = redis.set.mock.calls[0];
    expect(setCall[0]).toBe("tryon:abc123");
    expect(setCall[2]).toBe("EX");
    expect(typeof setCall[3]).toBe("number");
  });

  test("does not throw on S3 error", async () => {
    isAvailable.mockReturnValue(true);
    s3Client.send.mockRejectedValue(new Error("S3 failure"));
    await expect(setCached("tryon:abc123", "base64data", "user1")).resolves.toBeUndefined();
  });
});
