const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { getFavorites, addFavorite, removeFavorite, isFavorite } = require("../services/dynamodb");
const { s3Client, S3_USER_BUCKET, GetObjectCommand, PutObjectCommand, getSignedUrl, fetchPhotoFromS3 } = require("../services/s3");

// In-memory presigned URL cache — avoids regenerating 13+ URLs per favorites load
// TTL: 50 minutes (presigned URLs expire at 60min)
const presignedUrlCache = new Map(); // key → { url, expiresAt }
const CACHE_TTL = 50 * 60 * 1000;

async function getCachedPresignedUrl(s3Key) {
  const cached = presignedUrlCache.get(s3Key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }
  const url = await getSignedUrl(s3Client, new GetObjectCommand({
    Bucket: S3_USER_BUCKET,
    Key: s3Key,
  }), { expiresIn: 3600 });
  presignedUrlCache.set(s3Key, { url, expiresAt: Date.now() + CACHE_TTL });
  return url;
}

// GET /api/favorites
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const favorites = await getFavorites(req.userId);
    console.log(`[favorites] GET — ${favorites.length} favorites found for user ${req.userId}`);

    // Generate presigned URLs for try-on result images
    const enriched = await Promise.all(favorites.map(async (fav) => {
      console.log(`[favorites]   asin=${fav.asin} tryOnResultKey="${fav.tryOnResultKey || '(empty)'}"`);
      if (fav.tryOnResultKey) {
        try {
          fav.tryOnResultUrl = await getCachedPresignedUrl(fav.tryOnResultKey);
          console.log(`[favorites]   → presigned URL generated OK`);
        } catch (err) {
          console.error(`[favorites]   → presigned URL FAILED:`, err.message);
        }
      }
      return fav;
    }));

    // Final check: log what we're sending back
    enriched.forEach((f, i) => {
      console.log(`[favorites]   FINAL[${i}] asin=${f.asin} hasUrl=${!!f.tryOnResultUrl} urlPreview=${f.tryOnResultUrl ? f.tryOnResultUrl.substring(0, 80) + '...' : 'NONE'}`);
    });
    res.json({ favorites: enriched });
  } catch (error) {
    next(error);
  }
});

// GET /api/favorites/:asin - Check if product is favorited
router.get("/:asin", requireAuth, async (req, res, next) => {
  try {
    const favorited = await isFavorite(req.userId, req.params.asin);
    res.json({ favorited });
  } catch (error) {
    next(error);
  }
});

// POST /api/favorites
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { asin, productTitle, productImage, productUrl, retailer, category, garmentClass, tryOnResultImage, outfitId } = req.body;

    console.log(`[favorites] POST — asin=${asin}, hasProductImage=${!!productImage}, hasTryOnResultImage=${!!tryOnResultImage}, tryOnImageLength=${tryOnResultImage ? tryOnResultImage.length : 0}`);

    if (!asin) {
      return res.status(400).json({ error: "asin is required" });
    }

    let tryOnResultKey = "";

    // Save try-on result image to S3 if provided
    if (tryOnResultImage) {
      tryOnResultKey = `users/${req.userId}/favorites/${asin}.jpg`;
      const buffer = Buffer.from(tryOnResultImage, "base64");
      await s3Client.send(new PutObjectCommand({
        Bucket: S3_USER_BUCKET,
        Key: tryOnResultKey,
        Body: buffer,
        ContentType: "image/jpeg",
      }));
    }

    const result = await addFavorite(req.userId, {
      asin,
      productTitle: productTitle || "",
      productImage: productImage || "",
      productUrl: productUrl || "",
      retailer: retailer || "amazon",
      category: category || "",
      garmentClass: garmentClass || "",
      tryOnResultKey,
      outfitId: outfitId || "",
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// GET /api/favorites/:asin/image - Return the try-on result image as base64 from S3
router.get("/:asin/image", requireAuth, async (req, res, next) => {
  try {
    const key = `users/${req.userId}/favorites/${req.params.asin}.jpg`;
    console.log(`[favorites] GET IMAGE — key=${key}`);
    const base64 = await fetchPhotoFromS3(key);
    console.log(`[favorites] GET IMAGE OK — ${base64.length} chars`);
    res.json({ image: base64 });
  } catch (error) {
    console.error(`[favorites] GET IMAGE FAILED:`, error.message);
    res.status(404).json({ error: "Try-on image not found" });
  }
});

// DELETE /api/favorites/:asin
router.delete("/:asin", requireAuth, async (req, res, next) => {
  try {
    const result = await removeFavorite(req.userId, req.params.asin);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
