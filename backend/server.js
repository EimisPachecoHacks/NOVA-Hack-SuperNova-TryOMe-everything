require("dotenv").config();

const express = require("express");
const compression = require("compression");
const log = require("./utils/logger");
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
const accountRoutes = require("./routes/account");
const shareRoutes = require("./routes/share");
const addToCartRoutes = require("./routes/addToCart");

const http = require("http");
const { Server: SocketIO } = require("socket.io");
const { setupVoiceAgent } = require("./routes/voiceAgent");

const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server for Express + Socket.IO
const server = http.createServer(app);
const io = new SocketIO(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 1e7, // 10MB for audio chunks
});

// Voice Agent — Nova Sonic bidirectional streaming via Socket.IO
setupVoiceAgent(io);

// Compress responses (gzip/br) — especially helps with large base64 payloads
app.use(compression());

// CORS middleware - allows chrome extensions and localhost
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

app.get("/health", async (req, res) => {
  const checks = { express: "ok" };

  // Check AWS Bedrock connectivity
  try {
    const { bedrockClient } = require("./services/bedrock");
    const { InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
    // Lightweight ping — send minimal prompt, expect quick failure or success
    await Promise.race([
      bedrockClient.send(new InvokeModelCommand({
        modelId: "amazon.nova-lite-v1:0",
        contentType: "application/json",
        body: JSON.stringify({ messages: [{ role: "user", content: [{ text: "hi" }] }], inferenceConfig: { maxTokens: 1 } }),
      })),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
    ]);
    checks.bedrock = "ok";
  } catch (err) {
    checks.bedrock = `error: ${err.message.substring(0, 80)}`;
  }

  // Check Gemini connectivity
  try {
    if (process.env.GEMINI_API_KEY) {
      const { GoogleGenAI } = require("@google/genai");
      const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      await Promise.race([
        client.models.list(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
      ]);
      checks.gemini = "ok";
    } else {
      checks.gemini = "no API key configured";
    }
  } catch (err) {
    checks.gemini = `error: ${err.message.substring(0, 80)}`;
  }

  // Check fal.ai connectivity
  try {
    if (process.env.FAL_KEY) {
      checks.falai = "configured";
    } else {
      checks.falai = "no API key configured";
    }
  } catch (err) {
    checks.falai = `error: ${err.message.substring(0, 80)}`;
  }

  const allOk = checks.bedrock === "ok" && (checks.gemini === "ok" || !process.env.GEMINI_API_KEY);
  const status = allOk ? "ok" : "degraded";

  res.status(allOk ? 200 : 503).json({ status, checks });
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
app.use("/api/account", accountRoutes);
app.use("/api/share", shareRoutes);
app.use("/api/add-to-cart", addToCartRoutes);

// Error handling middleware
app.use((err, req, res, next) => {
  log.error(`${req.method} ${req.path}`, { message: err.message, stack: err.stack });

  const statusCode = err.statusCode || 500;
  // Pass through meaningful API errors (rate limits, quota, etc.) but hide stack traces
  let clientMessage = "Internal server error";
  if (statusCode < 500) {
    clientMessage = err.message || "Internal server error";
  } else if (err.message && (err.message.includes("RESOURCE_EXHAUSTED") || err.message.includes("quota"))) {
    clientMessage = "AI service rate limit exceeded — please wait a moment and try again";
  } else if (err.message && err.message.includes("429")) {
    clientMessage = "Too many requests — please wait a moment and try again";
  }
  res.status(statusCode).json({ error: clientMessage });
});

// ---------------------------------------------------------------------------
// #28: Validate critical environment variables before starting
// ---------------------------------------------------------------------------
const REQUIRED_ENV = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];
const OPTIONAL_ENV = ["GEMINI_API_KEY", "FAL_KEY", "COGNITO_USER_POOL_ID", "S3_USER_BUCKET", "REDIS_HOST"];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length) {
  log.error(`Missing REQUIRED env vars: ${missing.join(", ")} — server may not function correctly`);
}
const missingOptional = OPTIONAL_ENV.filter((k) => !process.env[k]);
if (missingOptional.length) {
  log.warn(`Missing optional env vars: ${missingOptional.join(", ")}`);
}

server.listen(PORT, () => {
  log.info(`NovaTryOnMe backend running on port ${PORT}`);
  log.info(`Health check: http://localhost:${PORT}/`);
  log.info(`AWS Region: ${process.env.AWS_REGION || "us-east-1"}`);
});
