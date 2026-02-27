const express = require("express");
const router = express.Router();
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { inpaint } = require("../services/novaCanvas");
const { optionalAuth } = require("../middleware/auth");
const { getProfile } = require("../services/dynamodb");

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
  },
});

const S3_USER_BUCKET = process.env.S3_USER_BUCKET || "nova-tryonme-users";

async function fetchPhotoFromS3(key) {
  const result = await s3Client.send(new GetObjectCommand({
    Bucket: S3_USER_BUCKET,
    Key: key,
  }));
  const chunks = [];
  for await (const chunk of result.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("base64");
}

// Mapping from cosmetic type to mask prompt
const COSMETIC_MASKS = {
  lipstick: "lips",
  eyeshadow: "eyelids and eye area",
  blush: "cheeks",
  foundation: "face skin",
  eyeliner: "eyelid edges",
  mascara: "eyelashes"
};

router.post("/", optionalAuth, async (req, res, next) => {
  try {
    let { faceImage, cosmeticType, color } = req.body;

    // If authenticated and no faceImage provided, fetch from S3
    if (!faceImage && req.userId) {
      const profile = await getProfile(req.userId);
      if (profile && profile.facePhotoKey) {
        faceImage = await fetchPhotoFromS3(profile.facePhotoKey);
      }
    }

    if (!faceImage || !cosmeticType || !color) {
      return res.status(400).json({ error: "faceImage, cosmeticType, and color are required" });
    }

    const maskPrompt = COSMETIC_MASKS[cosmeticType.toLowerCase()];
    if (!maskPrompt) {
      return res.status(400).json({ error: `Unsupported cosmetic type. Supported: ${Object.keys(COSMETIC_MASKS).join(", ")}` });
    }

    const textPrompt = `Apply ${color} ${cosmeticType} with natural, realistic finish. Professional makeup look.`;
    console.log(`[cosmetics] Processing - type: ${cosmeticType}, color: ${color}, mask: ${maskPrompt}, authenticated: ${!!req.userId}`);

    const resultImage = await inpaint(faceImage, maskPrompt, textPrompt);
    res.json({ resultImage });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
