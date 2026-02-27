#!/usr/bin/env node

/**
 * SuperNova TryOnMe - Profile Photo Generation Test Script
 *
 * Tests the AI profile photo generation using gemini-3.1-flash-image-preview.
 * Sends 5 user reference images + 1 pose template per call, generates 3 posed images.
 *
 * Usage:
 *   cd backend && node ../scripts/test-profile-gen.js
 *   (needs .env with GEMINI_API_KEY)
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BACKEND = path.join(ROOT, "backend");

// Load deps from backend/node_modules
require(path.join(BACKEND, "node_modules", "dotenv")).config({ path: path.join(BACKEND, ".env") });
const { GoogleGenAI } = require(path.join(BACKEND, "node_modules", "@google", "genai"));
const OUTPUT = path.join(ROOT, "output");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
  console.error("\x1b[31mError: GEMINI_API_KEY not set. Run from backend/ dir or set env var.\x1b[0m");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// ---------------------------------------------------------------------------
// Load images as base64
// ---------------------------------------------------------------------------

function loadImage(filename) {
  const filepath = path.join(ROOT, filename);
  if (!fs.existsSync(filepath)) {
    console.error(`\x1b[31mFile not found: ${filepath}\x1b[0m`);
    process.exit(1);
  }
  const buffer = fs.readFileSync(filepath);
  const ext = path.extname(filename).toLowerCase();
  const mimeType = ext === ".png" ? "image/png" : "image/jpeg";
  console.log(`  Loaded: ${filename} (${(buffer.length / 1024).toFixed(0)} KB)`);
  return { base64: buffer.toString("base64"), mimeType };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const PROMPT = `You are a professional portrait photography system specializing in identity-preserving image generation.

You will receive 7 images total:
- Images 1-3: Full body reference photos of a specific person
- Images 4-5: Face close-up reference photos of the SAME person
- Image 6: A pose template showing the desired body position

YOUR TASK: Generate a single new full-body photo of the EXACT person from images 1-5, recreating the EXACT pose from image 6.

IDENTITY RULES (CRITICAL — #1 PRIORITY):
- The generated person MUST be the EXACT same person from the reference photos
- Preserve IDENTICAL: face shape, facial bone structure, nose, eyes, eyebrows, lips, skin color/tone, hair color, hair style, body proportions, body type
- Study ALL 5 reference photos carefully to learn this person's unique features
- Do NOT create a different person. Do NOT use the person from the pose template image. Only copy the POSE, not the person's identity.

OUTPUT REQUIREMENTS:
- Recreate the exact pose/body position from the pose template (image 6)
- Dress the person in: simple white fitted t-shirt and classic blue jeans
- Clean white/light gray studio background
- Professional studio lighting, soft shadows
- Full body visible from head to feet
- Photorealistic, high quality
- Output only the image`;

// ---------------------------------------------------------------------------
// Generate one profile photo
// ---------------------------------------------------------------------------

async function generatePose(userImages, poseTemplate, poseIndex) {
  const label = `POSE ${poseIndex + 1}`;
  console.log(`\n\x1b[1m\x1b[35m▶ GENERATING ${label}\x1b[0m [gemini-3.1-flash-image-preview]`);

  const startTime = Date.now();

  const contents = [
    { text: PROMPT },
    // 3 full body reference photos
    { text: "Reference photo 1 (full body):" },
    { inlineData: { mimeType: userImages[0].mimeType, data: userImages[0].base64 } },
    { text: "Reference photo 2 (full body):" },
    { inlineData: { mimeType: userImages[1].mimeType, data: userImages[1].base64 } },
    { text: "Reference photo 3 (full body):" },
    { inlineData: { mimeType: userImages[2].mimeType, data: userImages[2].base64 } },
    // 2 face close-up reference photos
    { text: "Reference photo 4 (face close-up):" },
    { inlineData: { mimeType: userImages[3].mimeType, data: userImages[3].base64 } },
    { text: "Reference photo 5 (face close-up):" },
    { inlineData: { mimeType: userImages[4].mimeType, data: userImages[4].base64 } },
    // Pose template
    { text: "Pose template — recreate this EXACT pose (but use the person from the reference photos, NOT this person):" },
    { inlineData: { mimeType: poseTemplate.mimeType, data: poseTemplate.base64 } },
  ];

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-image-preview",
      contents: contents,
      config: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: {
          aspectRatio: "3:4",
        },
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const candidates = response.candidates || [];

    if (!candidates.length) {
      console.log(`\x1b[31m  ✗ ${label} FAILED — no candidates in response (${elapsed}s)\x1b[0m`);
      return null;
    }

    const parts = candidates[0].content?.parts || [];

    // Log any text output
    for (const part of parts) {
      if (part.text) {
        console.log(`\x1b[36m  [text]: ${part.text.substring(0, 200)}\x1b[0m`);
      }
    }

    // Find image output
    for (const part of parts) {
      if (part.inlineData) {
        const imageData = part.inlineData.data;
        const outputFile = path.join(OUTPUT, `profile_pose${poseIndex + 1}.png`);
        const buffer = Buffer.from(imageData, "base64");
        fs.writeFileSync(outputFile, buffer);
        console.log(`\x1b[32m  ✓ ${label} COMPLETE (${elapsed}s) — saved to ${outputFile} (${(buffer.length / 1024).toFixed(0)} KB)\x1b[0m`);
        return imageData;
      }
    }

    console.log(`\x1b[31m  ✗ ${label} FAILED — no image in response (${elapsed}s)\x1b[0m`);
    return null;
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\x1b[31m  ✗ ${label} ERROR (${elapsed}s): ${err.message}\x1b[0m`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("\x1b[1m\x1b[33m");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║     SuperNova TryOnMe - Profile Photo Generation Test   ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("\x1b[0m");

  // Ensure output dir exists
  if (!fs.existsSync(OUTPUT)) {
    fs.mkdirSync(OUTPUT, { recursive: true });
  }

  // Load user reference images
  console.log("\x1b[1mLoading user reference images:\x1b[0m");
  const userImages = [
    loadImage("user_full_body1.jpg"),
    loadImage("user_full_body2.jpg"),
    loadImage("user_full_body3.jpg"),
    loadImage("user_face1.jpg"),
    loadImage("user_face2.jpg"),
  ];

  // Load pose templates
  console.log("\n\x1b[1mLoading pose templates:\x1b[0m");
  const poseTemplates = [
    loadImage("pose_template1.png"),
    loadImage("pose_template2.png"),
    loadImage("pose_template3.png"),
  ];

  const totalStart = Date.now();

  // Generate 3 poses sequentially
  const results = [];
  for (let i = 0; i < poseTemplates.length; i++) {
    const result = await generatePose(userImages, poseTemplates[i], i);
    results.push(result);
  }

  const totalElapsed = ((Date.now() - totalStart) / 1000).toFixed(1);

  // Summary
  console.log("\n\x1b[1m\x1b[33m");
  console.log("╔══════════════════════════════════════════════════════════╗");
  const successCount = results.filter(Boolean).length;
  console.log(`║  ✅ DONE — ${successCount}/3 poses generated in ${totalElapsed}s`);
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("\x1b[0m");

  if (successCount > 0) {
    console.log(`Output images saved to: ${OUTPUT}/`);
    console.log("  - profile_pose1.png");
    console.log("  - profile_pose2.png");
    console.log("  - profile_pose3.png");
  }
}

main().catch(console.error);
