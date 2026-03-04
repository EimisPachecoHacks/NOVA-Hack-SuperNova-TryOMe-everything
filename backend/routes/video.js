const express = require("express");
const router = express.Router();
const { generateVideo: grokGenerateVideo, getVideoStatus: grokGetVideoStatus } = require("../services/grok");
const { requireAuth, optionalAuth } = require("../middleware/auth");
const { getProfile, getUserVideos, saveVideoRecord, removeVideo } = require("../services/dynamodb");
const { s3Client, S3_USER_BUCKET, PutObjectCommand, GetObjectCommand, getSignedUrl } = require("../services/s3");

router.post("/", optionalAuth, async (req, res, next) => {
  try {
    const { image, prompt } = req.body;
    if (!image) {
      return res.status(400).json({ error: "image is required" });
    }

    console.log("[video] Starting video generation job - provider: grok");

    // Get user's sex for correct pronouns in default prompt
    let sex = null;
    if (req.userId) {
      try {
        const profile = await getProfile(req.userId);
        sex = profile?.sex || null;
      } catch (_) { /* ignore */ }
    }

    const result = await grokGenerateVideo(image, prompt, sex);
    res.json({ jobId: result.requestId, provider: "grok" });
  } catch (error) {
    next(error);
  }
});

// GET /api/video/list — List user's saved videos with presigned playback URLs
// NOTE: Must be before /:jobId to avoid "list" being treated as a jobId
router.get("/list", requireAuth, async (req, res, next) => {
  try {
    const videos = await getUserVideos(req.userId);
    console.log(`[video] GET list — ${videos.length} videos for user ${req.userId}`);

    const enriched = await Promise.all(videos.map(async (v) => {
      try {
        v.videoUrl = await getSignedUrl(s3Client, new GetObjectCommand({
          Bucket: S3_USER_BUCKET,
          Key: v.videoKey,
        }), { expiresIn: 3600 });
      } catch (err) {
        console.error(`[video] presigned URL failed for ${v.videoKey}:`, err.message);
      }
      return v;
    }));

    res.json({ videos: enriched });
  } catch (error) {
    next(error);
  }
});

router.get("/:jobId", async (req, res, next) => {
  try {
    const jobId = decodeURIComponent(req.params.jobId);
    console.log(`[video] Checking status for job: ${jobId}, provider: grok`);

    const status = await grokGetVideoStatus(jobId);
    res.json(status);
  } catch (error) {
    next(error);
  }
});

// POST /api/video/save — Save a video to S3 and store metadata in DynamoDB
router.post("/save", requireAuth, async (req, res, next) => {
  try {
    const { videoUrl, videoBase64, asin, productTitle, productImage } = req.body;

    if (!videoUrl && !videoBase64) {
      return res.status(400).json({ error: "videoUrl or videoBase64 is required" });
    }

    const timestamp = Date.now();
    const videoId = `video_${timestamp}`;
    const key = `users/${req.userId}/videos/${asin || "tryon"}_${timestamp}.mp4`;

    let videoBuffer;
    if (videoBase64) {
      videoBuffer = Buffer.from(videoBase64, "base64");
    } else {
      const response = await fetch(videoUrl);
      if (!response.ok) throw new Error(`Failed to fetch video: ${response.status}`);
      videoBuffer = Buffer.from(await response.arrayBuffer());
    }

    console.log(`[video] Saving video to S3: ${key} (${videoBuffer.length} bytes)`);

    await s3Client.send(new PutObjectCommand({
      Bucket: S3_USER_BUCKET,
      Key: key,
      Body: videoBuffer,
      ContentType: "video/mp4",
    }));

    // Store metadata in DynamoDB
    const record = await saveVideoRecord(req.userId, {
      videoId,
      videoKey: key,
      asin: asin || "",
      productTitle: productTitle || "",
      productImage: productImage || "",
    });

    console.log(`[video] Video saved to S3 + DynamoDB: ${key}`);
    res.json({ videoKey: key, videoId: record.videoId });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/video/:videoId — Remove a saved video
router.delete("/:videoId", requireAuth, async (req, res, next) => {
  try {
    const result = await removeVideo(req.userId, req.params.videoId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
