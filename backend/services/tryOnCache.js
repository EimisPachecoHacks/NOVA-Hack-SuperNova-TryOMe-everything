const crypto = require("crypto");
const { redis, isAvailable } = require("./redis");
const { s3Client, S3_USER_BUCKET, PutObjectCommand, fetchPhotoFromS3 } = require("./s3");

const CACHE_TTL = parseInt(process.env.TRYON_CACHE_TTL, 10) || 48 * 60 * 60; // 48 hours default

/**
 * Build a deterministic cache key from try-on inputs.
 * Uses first 16KB of each image for the hash (enough to uniquely identify,
 * avoids hashing multi-MB base64 strings which would be slow).
 */
function buildCacheKey(userId, referenceImage, garmentClass, framing, poseIndex) {
  const hash = crypto.createHash("sha256");
  hash.update(userId || "anon");
  hash.update((referenceImage || "").substring(0, 16384)); // first 16KB of garment image
  hash.update(garmentClass || "");
  hash.update(framing || "full");
  hash.update(String(poseIndex ?? 0));
  return `tryon:${hash.digest("hex")}`;
}

/**
 * Build cache key for outfit try-on (multiple garments).
 */
function buildOutfitCacheKey(userId, garments, framing, poseIndex) {
  const hash = crypto.createHash("sha256");
  hash.update(userId || "anon");
  for (const g of garments) {
    hash.update(g.imageBase64.substring(0, 16384));
    hash.update(g.garmentClass || "");
  }
  hash.update(framing || "full");
  hash.update(String(poseIndex ?? 0));
  return `tryon:outfit:${hash.digest("hex")}`;
}

/**
 * Look up a cached try-on result.
 * Returns the base64 result image string, or null if not cached.
 */
async function getCached(cacheKey) {
  if (!isAvailable()) return null;
  try {
    const s3Key = await redis.get(cacheKey);
    if (!s3Key) return null;
    // Fetch the cached image from S3
    const base64 = await fetchPhotoFromS3(s3Key);
    return base64;
  } catch (err) {
    console.warn(`[tryOnCache] GET failed: ${err.message}`);
    return null;
  }
}

/**
 * Store a try-on result in the cache.
 * Saves the image to S3 under a cache-specific key, then stores
 * the S3 key in Redis with TTL.
 */
async function setCached(cacheKey, resultImage, userId) {
  if (!isAvailable()) return;
  try {
    const s3Key = `cache/${userId || "anon"}/${cacheKey.replace("tryon:", "")}.jpg`;
    const buffer = Buffer.from(resultImage, "base64");
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_USER_BUCKET,
      Key: s3Key,
      Body: buffer,
      ContentType: "image/jpeg",
    }));
    await redis.set(cacheKey, s3Key, "EX", CACHE_TTL);
  } catch (err) {
    // Non-critical — just skip caching
    console.warn(`[tryOnCache] SET failed: ${err.message}`);
  }
}

module.exports = { buildCacheKey, buildOutfitCacheKey, getCached, setCached };
