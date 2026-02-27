const express = require("express");
const router = express.Router();
const { removeBackground } = require("../services/novaCanvas");

router.post("/remove-bg", async (req, res, next) => {
  try {
    const { image } = req.body;
    if (!image) {
      return res.status(400).json({ error: "image is required" });
    }

    console.log("[image] Processing background removal");
    const resultImage = await removeBackground(image);
    res.json({ resultImage });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
