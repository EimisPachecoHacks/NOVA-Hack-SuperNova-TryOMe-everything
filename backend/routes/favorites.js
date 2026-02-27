const express = require("express");
const router = express.Router();
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
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
    res.json({ favorites });
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
    const { asin, productTitle, productImage, category, garmentClass, tryOnResultImage } = req.body;

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
    });

    res.json(result);
  } catch (error) {
    next(error);
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
