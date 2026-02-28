const express = require("express");
const router = express.Router();
const { generateVideo: grokGenerateVideo, getVideoStatus: grokGetVideoStatus } = require("../services/grok");

router.post("/", async (req, res, next) => {
  try {
    const { image, prompt } = req.body;
    if (!image) {
      return res.status(400).json({ error: "image is required" });
    }

    console.log("[video] Starting video generation job - provider: grok");

    const result = await grokGenerateVideo(image, prompt);
    res.json({ jobId: result.requestId, provider: "grok" });
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

module.exports = router;
