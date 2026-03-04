const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/auth");
const { execFile } = require("child_process");
const path = require("path");

// POST /api/add-to-cart
// Body: { productUrls: ["https://amazon.com/dp/...", ...] }
router.post("/", requireAuth, async (req, res, next) => {
  try {
    const { productUrls } = req.body;

    if (!productUrls || !Array.isArray(productUrls) || productUrls.length === 0) {
      return res.status(400).json({ error: "productUrls array is required" });
    }

    console.log(`[add-to-cart] User ${req.userId} — adding ${productUrls.length} item(s) to cart`);

    const scriptPath = path.join(__dirname, "..", "python-services", "add_to_cart.py");
    const results = [];

    for (const url of productUrls) {
      console.log(`[add-to-cart]   Processing: ${url}`);
      try {
        const result = await new Promise((resolve, reject) => {
          execFile("python3", [scriptPath, url], { timeout: 120000 }, (err, stdout, stderr) => {
            if (err) return reject(new Error(stderr || err.message));
            try {
              resolve(JSON.parse(stdout));
            } catch {
              resolve({ status: "success", message: stdout.trim() });
            }
          });
        });
        results.push({ url, status: result.status || "success", message: result.message });
      } catch (err) {
        console.error(`[add-to-cart]   Failed for ${url}:`, err.message);
        results.push({ url, status: "error", message: err.message });
      }
    }

    const allSuccess = results.every(r => r.status === "success");
    res.json({
      status: allSuccess ? "success" : "partial",
      message: allSuccess
        ? `${results.length} item(s) added to cart successfully`
        : `${results.filter(r => r.status === "success").length}/${results.length} items added`,
      results,
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
