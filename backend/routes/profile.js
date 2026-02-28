const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { requireAuth } = require("../middleware/auth");
const { getProfile, putProfile } = require("../services/dynamodb");
const { generateProfilePhoto } = require("../services/gemini");

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
  },
});

const S3_USER_BUCKET = process.env.S3_USER_BUCKET || "nova-tryonme-users";

// GET /api/profile
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.userId);
    if (!profile) {
      return res.json({ profileComplete: false });
    }
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

// PUT /api/profile
router.put("/", requireAuth, async (req, res, next) => {
  try {
    const { firstName, lastName, birthday, country, city } = req.body;

    // Calculate age from birthday
    let age = null;
    if (birthday) {
      const birthDate = new Date(birthday);
      const today = new Date();
      age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
    }

    const existing = await getProfile(req.userId) || {};
    const profileData = {
      ...existing,
      firstName: firstName || existing.firstName,
      lastName: lastName || existing.lastName,
      birthday: birthday || existing.birthday,
      age: age !== null ? age : existing.age,
      country: country || existing.country,
      city: city || existing.city,
      email: req.userEmail || existing.email,
    };

    // Check if profile is complete
    profileData.profileComplete = !!(
      profileData.firstName &&
      profileData.lastName &&
      profileData.birthday &&
      profileData.bodyPhotoKey &&
      profileData.facePhotoKey
    );

    const result = await putProfile(req.userId, profileData);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// POST /api/profile/photos
router.post("/photos", requireAuth, async (req, res, next) => {
  try {
    const { type, image } = req.body;

    if (!type || !image) {
      return res.status(400).json({ error: "type (body|face) and image (base64) are required" });
    }

    if (type !== "body" && type !== "face") {
      return res.status(400).json({ error: "type must be 'body' or 'face'" });
    }

    const key = `users/${req.userId}/${type}.jpg`;
    const buffer = Buffer.from(image, "base64");

    await s3Client.send(new PutObjectCommand({
      Bucket: S3_USER_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
    }));

    // Update profile with photo key
    const existing = await getProfile(req.userId) || {};
    const photoField = type === "body" ? "bodyPhotoKey" : "facePhotoKey";
    const profileData = {
      ...existing,
      [photoField]: key,
      email: req.userEmail || existing.email,
    };

    // Check if profile is complete
    profileData.profileComplete = !!(
      profileData.firstName &&
      profileData.lastName &&
      profileData.birthday &&
      profileData.bodyPhotoKey &&
      profileData.facePhotoKey
    );

    await putProfile(req.userId, profileData);

    res.json({ key, profileComplete: profileData.profileComplete });
  } catch (error) {
    next(error);
  }
});

// GET /api/profile/photo/:type - Get user photo as base64
router.get("/photo/:type", requireAuth, async (req, res, next) => {
  try {
    const { type } = req.params;
    if (type !== "body" && type !== "face") {
      return res.status(400).json({ error: "type must be 'body' or 'face'" });
    }

    const profile = await getProfile(req.userId);
    const photoKey = type === "body" ? profile?.bodyPhotoKey : profile?.facePhotoKey;

    if (!photoKey) {
      return res.status(404).json({ error: `No ${type} photo found` });
    }

    const result = await s3Client.send(new GetObjectCommand({
      Bucket: S3_USER_BUCKET,
      Key: photoKey,
    }));

    const chunks = [];
    for await (const chunk of result.Body) {
      chunks.push(chunk);
    }
    const base64 = Buffer.concat(chunks).toString("base64");

    res.json({ image: base64 });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// POST /api/profile/generate-photos
// Receives 5 user images, generates 3 AI-posed profile photos
// ---------------------------------------------------------------------------
router.post("/generate-photos", requireAuth, async (req, res, next) => {
  try {
    const { userImages } = req.body;

    if (!userImages || !Array.isArray(userImages) || userImages.length !== 5) {
      return res.status(400).json({ error: "userImages must be an array of 5 base64 strings (3 body + 2 face)" });
    }

    console.log("\x1b[1m\x1b[33m╔══════════════════════════════════════════════════════════╗");
    console.log("║     PROFILE PHOTO GENERATION — 3 Poses                  ║");
    console.log("╚══════════════════════════════════════════════════════════╝\x1b[0m");

    // Load pose templates from backend/assets/
    const assetsDir = path.join(__dirname, "..", "assets");
    const poseTemplateFiles = ["pose_template1.png", "pose_template2.png", "pose_template3.png"];
    const poseTemplates = poseTemplateFiles.map((file) => {
      const filepath = path.join(assetsDir, file);
      return fs.readFileSync(filepath).toString("base64");
    });

    // Store 5 original user images in S3
    const originalKeys = [];
    const bodyLabels = ["original_body_0", "original_body_1", "original_body_2"];
    const faceLabels = ["original_face_0", "original_face_1"];
    const allLabels = [...bodyLabels, ...faceLabels];

    for (let i = 0; i < 5; i++) {
      const key = `users/${req.userId}/${allLabels[i]}.jpg`;
      const buffer = Buffer.from(userImages[i], "base64");
      await s3Client.send(new PutObjectCommand({
        Bucket: S3_USER_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: "image/jpeg",
      }));
      originalKeys.push(key);
      console.log(`\x1b[36m  Stored: ${key} (${(buffer.length / 1024).toFixed(0)} KB)\x1b[0m`);
    }

    // Generate 3 posed profile photos
    const generatedPhotos = [];
    const generatedKeys = [];
    const totalStart = Date.now();

    for (let i = 0; i < 3; i++) {
      const poseLabel = `POSE ${i + 1}/3`;
      console.log(`\n\x1b[1m\x1b[35m▶ GENERATING ${poseLabel}\x1b[0m [gemini-3.1-flash-image-preview]`);
      const stepStart = Date.now();

      try {
        const resultBase64 = await generateProfilePhoto(userImages, poseTemplates[i]);
        const elapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
        console.log(`\x1b[32m  ✓ ${poseLabel} COMPLETE (${elapsed}s) — ${resultBase64.length} chars\x1b[0m`);

        generatedPhotos.push(resultBase64);

        // Store generated image in S3
        const key = `users/${req.userId}/generated_pose_${i}.jpg`;
        const buffer = Buffer.from(resultBase64, "base64");
        await s3Client.send(new PutObjectCommand({
          Bucket: S3_USER_BUCKET,
          Key: key,
          Body: buffer,
          ContentType: "image/jpeg",
        }));
        generatedKeys.push(key);
      } catch (err) {
        const elapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
        console.log(`\x1b[31m  ✗ ${poseLabel} FAILED (${elapsed}s): ${err.message}\x1b[0m`);
        generatedPhotos.push(null);
      }
    }

    const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);
    const successCount = generatedPhotos.filter(Boolean).length;

    console.log(`\n\x1b[1m\x1b[33m╔══════════════════════════════════════════════════════════╗`);
    console.log(`║  ✅ PROFILE GENERATION DONE — ${successCount}/3 in ${totalElapsed}s`);
    console.log(`╚══════════════════════════════════════════════════════════╝\x1b[0m`);

    // Update profile in DynamoDB
    const existing = await getProfile(req.userId) || {};
    const profileData = {
      ...existing,
      originalPhotoKeys: originalKeys,
      generatedPhotoKeys: generatedKeys,
      // Set first generated photo as bodyPhotoKey for backward compat with try-on
      bodyPhotoKey: generatedKeys[0] || existing.bodyPhotoKey,
      // Set first face as facePhotoKey for backward compat
      facePhotoKey: originalKeys[3] || existing.facePhotoKey,
      email: req.userEmail || existing.email,
    };

    profileData.profileComplete = !!(
      profileData.firstName &&
      profileData.lastName &&
      profileData.birthday &&
      profileData.bodyPhotoKey &&
      profileData.facePhotoKey
    );

    await putProfile(req.userId, profileData);

    res.json({
      success: true,
      generatedPhotos,
      profileComplete: profileData.profileComplete,
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// PUT /api/profile/photos/original/:index - Replace a specific original photo
// ---------------------------------------------------------------------------
router.put("/photos/original/:index", requireAuth, async (req, res, next) => {
  try {
    const index = parseInt(req.params.index, 10);
    if (isNaN(index) || index < 0 || index > 4) {
      return res.status(400).json({ error: "index must be 0-4" });
    }

    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: "image (base64) is required" });
    }

    const profile = await getProfile(req.userId);
    if (!profile || !profile.originalPhotoKeys || !profile.originalPhotoKeys[index]) {
      return res.status(404).json({ error: "Original photo not found at this index" });
    }

    // Overwrite the existing S3 key
    const key = profile.originalPhotoKeys[index];
    const buffer = Buffer.from(image, "base64");
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_USER_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: "image/jpeg",
    }));

    console.log(`[profile] Replaced original photo [${index}]: ${key} (${(buffer.length / 1024).toFixed(0)} KB)`);

    res.json({ success: true, index, key });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/profile/photos/all - Get all 8 photos (5 original + 3 generated)
// ---------------------------------------------------------------------------
router.get("/photos/all", requireAuth, async (req, res, next) => {
  try {
    const profile = await getProfile(req.userId);
    if (!profile) {
      return res.json({ originals: [], generated: [] });
    }

    const fetchFromS3 = async (key) => {
      try {
        const result = await s3Client.send(new GetObjectCommand({
          Bucket: S3_USER_BUCKET,
          Key: key,
        }));
        const chunks = [];
        for await (const chunk of result.Body) {
          chunks.push(chunk);
        }
        return Buffer.concat(chunks).toString("base64");
      } catch (_) {
        return null;
      }
    };

    const originals = [];
    if (profile.originalPhotoKeys) {
      for (const key of profile.originalPhotoKeys) {
        originals.push(await fetchFromS3(key));
      }
    }

    const generated = [];
    if (profile.generatedPhotoKeys) {
      for (const key of profile.generatedPhotoKeys) {
        generated.push(await fetchFromS3(key));
      }
    }

    res.json({ originals, generated });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
