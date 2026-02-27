require("dotenv").config();

const express = require("express");
const corsMiddleware = require("./middleware/cors");
const { validateImagePayload } = require("./middleware/validation");

const tryOnRoutes = require("./routes/tryOn");
const cosmeticsRoutes = require("./routes/cosmetics");
const analyzeRoutes = require("./routes/analyze");
const videoRoutes = require("./routes/video");
const imageRoutes = require("./routes/image");
const authRoutes = require("./routes/auth");
const profileRoutes = require("./routes/profile");
const favoritesRoutes = require("./routes/favorites");
const smartSearchRoutes = require("./routes/smartSearch");

const app = express();
const PORT = process.env.PORT || 3000;

// CORS middleware - allow all origins (for chrome-extension:// during dev)
app.use(corsMiddleware);

// JSON body parser with 50MB limit (base64 images are large)
app.use(express.json({ limit: "50mb" }));

// Request validation
app.use(validateImagePayload);

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "SuperNova TryOnMe Backend",
    version: "1.0.0",
    timestamp: new Date().toISOString()
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// Mount routes
app.use("/api/auth", authRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/favorites", favoritesRoutes);
app.use("/api/analyze", analyzeRoutes);
app.use("/api/try-on", tryOnRoutes);
app.use("/api/cosmetics", cosmeticsRoutes);
app.use("/api/video", videoRoutes);
app.use("/api/image", imageRoutes);
app.use("/api/smart-search", smartSearchRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("=== Error ===");
  console.error("Path:", req.path);
  console.error("Message:", err.message);
  console.error("Stack:", err.stack);

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message || "Internal server error"
  });
});

app.listen(PORT, () => {
  console.log(`NovaTryOnMe backend running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/`);
  console.log(`AWS Region: ${process.env.AWS_REGION || "us-east-1"}`);
});
