const express = require("express");
const router = express.Router();
const { analyzeProduct } = require("../services/novaLite");

router.post("/", async (req, res, next) => {
  try {
    const { productImage, title, breadcrumbs } = req.body;

    if (!productImage) {
      return res.status(400).json({ error: "productImage is required" });
    }

    console.log(`Analyzing product: ${title || "unknown"}`);
    const analysis = await analyzeProduct(
      productImage,
      title || "Unknown product",
      breadcrumbs || ""
    );

    console.log("Analysis result:", JSON.stringify(analysis));
    res.json(analysis);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
