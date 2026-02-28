const express = require("express");
const router = express.Router();
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { requireAuth } = require("../middleware/auth");
const { getFavorites, addFavorite, removeFavorite, isFavorite } = require("../services/dynamodb");

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
  },
});

const S3_USER_BUCKET = process.env.S3_USER_BUCKET || "nova-tryonme-users";

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
          fav.tryOnResultUrl = await getSignedUrl(s3Client, new GetObjectCommand({
            Bucket: S3_USER_BUCKET,
            Key: fav.tryOnResultKey,
          }), { expiresIn: 3600 });
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
    const { asin, productTitle, productImage, category, garmentClass, tryOnResultImage, outfitId } = req.body;

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
    const command = new GetObjectCommand({ Bucket: S3_USER_BUCKET, Key: key });
    const s3Response = await s3Client.send(command);
    const chunks = [];
    for await (const chunk of s3Response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    const base64 = buffer.toString("base64");
    console.log(`[favorites] GET IMAGE OK — ${buffer.length} bytes`);
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
