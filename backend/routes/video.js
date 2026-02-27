const express = require("express");
const router = express.Router();
const { generateVideo: novaGenerateVideo, getVideoStatus: novaGetVideoStatus } = require("../services/novaReel");
const { generateVideo: veoGenerateVideo, getVideoStatus: veoGetVideoStatus } = require("../services/veo");

router.post("/", async (req, res, next) => {
  try {
    const { image, prompt, provider: reqProvider } = req.body;
    if (!image) {
      return res.status(400).json({ error: "image is required" });
    }

    const provider = reqProvider || process.env.VIDEO_PROVIDER || "veo";
    console.log(`[video] Starting video generation job - provider: ${provider}`);

    if (provider === "veo" && process.env.GEMINI_API_KEY) {
      const result = await veoGenerateVideo(image, prompt);
      res.json({ jobId: result.operationName, provider: "veo" });
    } else {
      const jobId = await novaGenerateVideo(image, prompt);
      res.json({ jobId, provider: "nova" });
    }
  } catch (error) {
    next(error);
  }
});

router.get("/:jobId", async (req, res, next) => {
  try {
    const jobId = decodeURIComponent(req.params.jobId);
    const provider = req.query.provider || "veo";
    console.log(`[video] Checking status for job: ${jobId}, provider: ${provider}`);

    let status;
    if (provider === "veo") {
      status = await veoGetVideoStatus(jobId);
    } else {
      status = await novaGetVideoStatus(jobId);
    }
    res.json(status);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
