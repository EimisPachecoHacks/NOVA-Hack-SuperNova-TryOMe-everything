const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");
const { requireAuth } = require("../middleware/auth");
const { getProfile, putProfile } = require("../services/dynamodb");
const { generateProfilePhoto } = require("../services/gemini");
const { s3Client, S3_USER_BUCKET, PutObjectCommand, fetchPhotoFromS3 } = require("../services/s3");

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
    const { birthday } = req.body;
    // Strip HTML/script tags from text fields to prevent XSS
    const stripTags = (s) => typeof s === "string" ? s.replace(/<[^>]*>/g, "").trim() : s;
    const firstName = stripTags(req.body.firstName);
    const lastName = stripTags(req.body.lastName);
    const country = stripTags(req.body.country);
    const city = stripTags(req.body.city);
    const sex = req.body.sex === "male" || req.body.sex === "female" ? req.body.sex : undefined;
    const clothesSize = stripTags(req.body.clothesSize);
    const shoesSize = req.body.shoesSize ? String(req.body.shoesSize).trim() : undefined;
    const language = stripTags(req.body.language);
    console.log(`[profile] PUT — language received: "${language}" (raw: "${req.body.language}")`);

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
      sex: sex || existing.sex,
      clothesSize: clothesSize || existing.clothesSize,
      shoesSize: shoesSize || existing.shoesSize,
      country: country || existing.country,
      city: city || existing.city,
      language: language || existing.language || "en",
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

    const base64 = await fetchPhotoFromS3(photoKey);
    res.json({ image: base64 });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------------------
// In-memory job store for async profile photo generation (#13)
// ---------------------------------------------------------------------------
const photoJobs = new Map(); // jobId → { status, generatedPhotos, profileComplete, error, createdAt }

// Cleanup jobs older than 30 minutes to prevent memory leaks
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of photoJobs) {
    if (job.createdAt < cutoff) photoJobs.delete(id);
  }
}, 5 * 60 * 1000);

/**
 * Run the actual photo generation logic (shared by sync and async modes).
 * Returns { generatedPhotos, profileComplete } or throws.
 */
async function runPhotoGeneration(userId, userEmail, userImages) {
  console.log("\x1b[1m\x1b[33m╔══════════════════════════════════════════════════════════╗");
  console.log("║     PROFILE PHOTO GENERATION — 3 Poses                  ║");
  console.log("╚══════════════════════════════════════════════════════════╝\x1b[0m");

  // Load pose templates from backend/assets/
  const assetsDir = path.join(__dirname, "..", "assets");
  const poseTemplateFiles = ["pose_template1.jpg", "pose_template2.jpg", "pose_template3.jpg"];
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
    const key = `users/${userId}/${allLabels[i]}.jpg`;
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

  // Generate 3 posed profile photos (chained: pose 1 result anchors poses 2 & 3)
  const generatedPhotos = [];
  const generatedKeys = [];
  let anchorImage = null;
  const totalStart = Date.now();

  const poseDescriptions = [
    "standing upright facing camera, hands resting at hip level, slight forward lean, weight on both feet",
    "mid-stride walking pose, left leg forward and right leg back, arms relaxed at sides, body angled slightly to the right",
    "standing facing camera, hands clasped together in front at waist level, legs slightly crossed, weight shifted to one side",
  ];

  for (let i = 0; i < 3; i++) {
    const poseLabel = `POSE ${i + 1}/3`;
    console.log(`\n\x1b[1m\x1b[35m▶ GENERATING ${poseLabel}\x1b[0m [gemini-3.1-flash-image-preview]${anchorImage ? " (with anchor)" : ""}`);
    const stepStart = Date.now();

    try {
      const resultBase64 = await generateProfilePhoto(userImages, poseTemplates[i], "image/jpeg", anchorImage, poseDescriptions[i]);
      const elapsed = ((Date.now() - stepStart) / 1000).toFixed(1);
      console.log(`\x1b[32m  ✓ ${poseLabel} COMPLETE (${elapsed}s) — ${resultBase64.length} chars\x1b[0m`);

      generatedPhotos.push(resultBase64);

      if (!anchorImage) {
        anchorImage = resultBase64;
        console.log(`\x1b[36m  ↳ Set as identity anchor for remaining poses\x1b[0m`);
      }

      const key = `users/${userId}/generated_pose_${i}.jpg`;
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
  const existing = await getProfile(userId) || {};
  const profileData = {
    ...existing,
    originalPhotoKeys: originalKeys,
    generatedPhotoKeys: generatedKeys,
    bodyPhotoKey: generatedKeys[0] || existing.bodyPhotoKey,
    facePhotoKey: originalKeys[3] || existing.facePhotoKey,
    email: userEmail || existing.email,
  };

  profileData.profileComplete = !!(
    profileData.firstName &&
    profileData.lastName &&
    profileData.birthday &&
    profileData.bodyPhotoKey &&
    profileData.facePhotoKey
  );

  await putProfile(userId, profileData);

  return { generatedPhotos, profileComplete: profileData.profileComplete };
}

// ---------------------------------------------------------------------------
// POST /api/profile/generate-photos
// Receives 5 user images, generates 3 AI-posed profile photos
// Supports async mode: pass { async: true } to get immediate jobId response
// ---------------------------------------------------------------------------
router.post("/generate-photos", requireAuth, async (req, res, next) => {
  try {
    const { userImages } = req.body;

    if (!userImages || !Array.isArray(userImages) || userImages.length !== 5) {
      return res.status(400).json({ error: "userImages must be an array of 5 base64 strings (3 body + 2 face)" });
    }

    // Validate that none of the 5 images are empty/null/undefined
    for (let idx = 0; idx < 5; idx++) {
      if (!userImages[idx] || typeof userImages[idx] !== "string" || userImages[idx].length < 100) {
        const label = idx < 3 ? `body photo ${idx + 1}` : `face photo ${idx - 2}`;
        return res.status(400).json({ error: `${label} is missing or invalid (image ${idx + 1} of 5)` });
      }
    }

    // ---------------------------------------------------------------
    // Async mode: return immediately, generate in background
    // ---------------------------------------------------------------
    if (req.body.async) {
      const { v4: uuidv4 } = require("uuid");
      const jobId = uuidv4();
      photoJobs.set(jobId, { status: "processing", createdAt: Date.now() });

      // Respond immediately — client polls GET /api/profile/generate-photos/status/:jobId
      res.json({ jobId, status: "processing" });

      // Fire-and-forget background generation
      runPhotoGeneration(req.userId, req.userEmail, userImages)
        .then((result) => {
          photoJobs.set(jobId, { status: "complete", ...result, createdAt: Date.now() });
        })
        .catch((err) => {
          console.error(`[profile] Async photo generation failed: ${err.message}`);
          photoJobs.set(jobId, { status: "error", error: err.message, createdAt: Date.now() });
        });
      return;
    }

    // ---------------------------------------------------------------
    // Synchronous mode (default — existing behavior, unchanged)
    // ---------------------------------------------------------------
    const result = await runPhotoGeneration(req.userId, req.userEmail, userImages);

    res.json({
      success: true,
      generatedPhotos: result.generatedPhotos,
      profileComplete: result.profileComplete,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/profile/generate-photos/status/:jobId — Poll for async generation status
router.get("/generate-photos/status/:jobId", requireAuth, (req, res) => {
  const job = photoJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found or expired" });
  }
  res.json(job);
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

    const safeFetch = async (key) => {
      try {
        return await fetchPhotoFromS3(key);
      } catch (err) {
        console.error(`[profile] Failed to fetch photo from S3: key=${key}, error=${err.message}`);
        return null;
      }
    };

    const originals = profile.originalPhotoKeys
      ? await Promise.all(profile.originalPhotoKeys.map(safeFetch))
      : [];

    const generated = profile.generatedPhotoKeys
      ? await Promise.all(profile.generatedPhotoKeys.map(safeFetch))
      : [];

    res.json({ originals, generated });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
