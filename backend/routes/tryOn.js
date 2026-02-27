const express = require("express");
const router = express.Router();
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { virtualTryOn: novaVirtualTryOn } = require("../services/novaCanvas");
const { virtualTryOn: geminiVirtualTryOn, extractGarment, buildSmartPrompt } = require("../services/gemini");
const { analyzeProduct, classifyOutfit, hasPersonInImage } = require("../services/novaLite");
const { optionalAuth } = require("../middleware/auth");
const { getProfile } = require("../services/dynamodb");

const s3Client = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    ...(process.env.AWS_SESSION_TOKEN && { sessionToken: process.env.AWS_SESSION_TOKEN }),
  },
});

const S3_USER_BUCKET = process.env.S3_USER_BUCKET || "nova-tryonme-users";

async function fetchPhotoFromS3(key) {
  const result = await s3Client.send(new GetObjectCommand({
    Bucket: S3_USER_BUCKET,
    Key: key,
  }));
  const chunks = [];
  for await (const chunk of result.Body) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("base64");
}

router.post("/", optionalAuth, async (req, res, next) => {
  try {
    let { sourceImage, referenceImage, garmentClass, mergeStyle } = req.body;

    // If authenticated and no sourceImage provided, fetch from S3
    if (!sourceImage && req.userId) {
      const profile = await getProfile(req.userId);
      if (profile && profile.bodyPhotoKey) {
        sourceImage = await fetchPhotoFromS3(profile.bodyPhotoKey);
      }
    }

    if (!sourceImage || !referenceImage) {
      return res.status(400).json({ error: "sourceImage and referenceImage are required" });
    }

    // Strip data URL prefix if present (e.g. "data:image/jpeg;base64,...")
    if (sourceImage && sourceImage.startsWith("data:")) {
      sourceImage = sourceImage.split(",")[1];
    }
    if (referenceImage && referenceImage.startsWith("data:")) {
      referenceImage = referenceImage.split(",")[1];
    }

    const provider = req.body.provider || process.env.TRYON_PROVIDER || "gemini";
    const startTime = Date.now();
    const debugSteps = [];

    console.log(`\n\x1b[1m\x1b[33m╔══════════════════════════════════════════════════════╗\x1b[0m`);
    console.log(`\x1b[1m\x1b[33m║           🔥 TRY-ON REQUEST RECEIVED 🔥              ║\x1b[0m`);
    console.log(`\x1b[1m\x1b[33m╚══════════════════════════════════════════════════════╝\x1b[0m`);
    console.log(`\x1b[36m  provider:\x1b[0m        \x1b[1m${provider}\x1b[0m`);
    console.log(`\x1b[36m  authenticated:\x1b[0m   ${!!req.userId}`);
    console.log(`\x1b[36m  sourceImage:\x1b[0m     ${sourceImage ? sourceImage.length : 0} chars`);
    console.log(`\x1b[36m  referenceImage:\x1b[0m  ${referenceImage ? referenceImage.length : 0} chars`);
    console.log(`\x1b[36m  garmentClass:\x1b[0m    \x1b[1m${garmentClass || "(will detect)"}\x1b[0m`);

    // ═══════════════════════════════════════════════════
    // STEP 1: PRODUCT ANALYSIS (Nova 2 Lite via Bedrock)
    // ═══════════════════════════════════════════════════
    let analysisResult = null;
    try {
      console.log(`\n\x1b[1m\x1b[35m▶ STEP 1: PRODUCT ANALYSIS [Nova 2 Lite via Bedrock]\x1b[0m`);
      console.log(`\x1b[90m  ℹ Analyze the product image to detect garment type, color, and category\x1b[0m`);
      const s1 = Date.now();
      analysisResult = await analyzeProduct(referenceImage, "", "");
      const s1t = ((Date.now() - s1) / 1000).toFixed(1);
      // Use detected garmentClass if not provided by frontend
      if (!garmentClass && analysisResult.garmentClass) {
        garmentClass = analysisResult.garmentClass;
      }
      console.log(`\x1b[32m  ✓ STEP 1 COMPLETE\x1b[0m \x1b[90m(${s1t}s)\x1b[0m`);
      console.log(`\x1b[36m    garmentClass:\x1b[0m      \x1b[1m${analysisResult.garmentClass}\x1b[0m`);
      console.log(`\x1b[36m    garmentSubClass:\x1b[0m   ${analysisResult.garmentSubClass || "N/A"}`);
      console.log(`\x1b[36m    category:\x1b[0m          ${analysisResult.category}`);
      console.log(`\x1b[36m    color:\x1b[0m             ${analysisResult.color || "N/A"}`);
      debugSteps.push({ step: "1", name: "PRODUCT ANALYSIS", model: "Nova 2 Lite via Bedrock", time: s1t + "s", result: analysisResult });
    } catch (err) {
      console.warn(`\x1b[31m  ✗ STEP 1 FAILED:\x1b[0m ${err.message}`);
      if (!garmentClass) garmentClass = "UPPER_BODY";
      debugSteps.push({ step: "1", name: "PRODUCT ANALYSIS", model: "Nova 2 Lite via Bedrock", time: "0s", result: { error: err.message, fallback: garmentClass } });
    }

    // Validate garmentClass
    const validClasses = [
      "UPPER_BODY", "LOWER_BODY", "FULL_BODY", "FOOTWEAR",
      "LONG_SLEEVE_SHIRT", "SHORT_SLEEVE_SHIRT", "NO_SLEEVE_SHIRT",
      "LONG_PANTS", "SHORT_PANTS", "LONG_DRESS", "SHORT_DRESS",
      "FULL_BODY_OUTFIT", "SHOES", "BOOTS"
    ];
    if (!garmentClass || !validClasses.includes(garmentClass)) {
      garmentClass = "UPPER_BODY";
    }

    // ═══════════════════════════════════════════════════
    // STEP 2: PERSON DETECTION (Nova 2 Lite via Bedrock)
    // ═══════════════════════════════════════════════════
    let personResult = { hasPerson: false, garmentDescription: null };
    try {
      console.log(`\n\x1b[1m\x1b[35m▶ STEP 2: PERSON DETECTION [Nova 2 Lite via Bedrock]\x1b[0m`);
      console.log(`\x1b[90m  ℹ Check if the product image contains a person/model wearing the garment\x1b[0m`);
      const s2 = Date.now();
      personResult = await hasPersonInImage(referenceImage);
      const s2t = ((Date.now() - s2) / 1000).toFixed(1);
      console.log(`\x1b[32m  ✓ STEP 2 COMPLETE\x1b[0m \x1b[90m(${s2t}s)\x1b[0m`);
      console.log(`\x1b[36m    hasPerson:\x1b[0m         \x1b[1m${personResult.hasPerson}\x1b[0m`);
      console.log(`\x1b[36m    garmentDesc:\x1b[0m       ${personResult.garmentDescription || "N/A"}`);
      debugSteps.push({ step: "2", name: "PERSON DETECTION", model: "Nova 2 Lite via Bedrock", time: s2t + "s", result: personResult });
    } catch (err) {
      console.warn(`\x1b[31m  ✗ STEP 2 FAILED:\x1b[0m ${err.message} — assuming no person`);
      debugSteps.push({ step: "2", name: "PERSON DETECTION", model: "Nova 2 Lite via Bedrock", time: "0s", result: { error: err.message, hasPerson: false } });
    }

    // ═══════════════════════════════════════════════════
    // STEP 2.1: GARMENT EXTRACTION (Gemini 2.5 Flash) [conditional]
    // ═══════════════════════════════════════════════════
    let garmentImageForTryOn = referenceImage;
    let garmentImageUsed = "original";
    if (personResult.hasPerson) {
      try {
        console.log(`\n\x1b[1m\x1b[35m▶ STEP 2.1: GARMENT EXTRACTION [Gemini 2.5 Flash Image]\x1b[0m`);
        console.log(`\x1b[90m  ℹ Extract the garment from the model photo into a clean white-background image\x1b[0m`);
        const s21 = Date.now();
        const extracted = await extractGarment(referenceImage, personResult.garmentDescription);
        const s21t = ((Date.now() - s21) / 1000).toFixed(1);
        if (extracted && extracted.length > 100) {
          garmentImageForTryOn = extracted;
          garmentImageUsed = "extracted";
          console.log(`\x1b[32m  ✓ STEP 2.1 COMPLETE\x1b[0m \x1b[90m(${s21t}s)\x1b[0m — extracted: ${extracted.length} chars`);
        } else {
          console.warn(`\x1b[33m  ⚠ STEP 2.1: extraction returned empty, using original\x1b[0m`);
        }
        debugSteps.push({ step: "2.1", name: "GARMENT EXTRACTION", model: "Gemini 2.5 Flash Image", time: s21t + "s", result: { extracted: garmentImageUsed === "extracted", imageLength: extracted ? extracted.length : 0 } });
      } catch (err) {
        console.warn(`\x1b[31m  ✗ STEP 2.1 FAILED:\x1b[0m ${err.message} — using original image`);
        debugSteps.push({ step: "2.1", name: "GARMENT EXTRACTION", model: "Gemini 2.5 Flash Image", time: "0s", result: { error: err.message, extracted: false } });
      }
    } else {
      console.log(`\n\x1b[90m  ⏭ STEP 2.1: SKIPPED (no person detected)\x1b[0m`);
      debugSteps.push({ step: "2.1", name: "GARMENT EXTRACTION", model: "Gemini 2.5 Flash Image", time: "skipped", result: { skipped: true, reason: "no person in image" } });
    }

    // ═══════════════════════════════════════════════════
    // STEP 3: OUTFIT CLASSIFICATION (Nova 2 Lite via Bedrock)
    // ═══════════════════════════════════════════════════
    let outfitInfo = null;
    try {
      console.log(`\n\x1b[1m\x1b[35m▶ STEP 3: OUTFIT CLASSIFICATION [Nova 2 Lite via Bedrock]\x1b[0m`);
      console.log(`\x1b[90m  ℹ Classify what the user is currently wearing (top+bottom, dress, outerwear) to handle outfit conflicts\x1b[0m`);
      const s3 = Date.now();
      outfitInfo = await classifyOutfit(sourceImage);
      const s3t = ((Date.now() - s3) / 1000).toFixed(1);
      console.log(`\x1b[32m  ✓ STEP 3 COMPLETE\x1b[0m \x1b[90m(${s3t}s)\x1b[0m`);
      console.log(`\x1b[36m    currentType:\x1b[0m       \x1b[1m${outfitInfo.currentType}\x1b[0m`);
      console.log(`\x1b[36m    fullDescription:\x1b[0m   ${outfitInfo.fullDescription || "N/A"}`);
      console.log(`\x1b[36m    upperDescription:\x1b[0m  ${outfitInfo.upperDescription || "N/A"}`);
      console.log(`\x1b[36m    lowerDescription:\x1b[0m  ${outfitInfo.lowerDescription || "N/A"}`);
      debugSteps.push({ step: "3", name: "OUTFIT CLASSIFICATION", model: "Nova 2 Lite via Bedrock", time: s3t + "s", result: outfitInfo });
    } catch (err) {
      console.warn(`\x1b[31m  ✗ STEP 3 FAILED:\x1b[0m ${err.message} — using default`);
      outfitInfo = { currentType: "UPPER_LOWER" };
      debugSteps.push({ step: "3", name: "OUTFIT CLASSIFICATION", model: "Nova 2 Lite via Bedrock", time: "0s", result: { error: err.message, fallback: outfitInfo } });
    }

    // ═══════════════════════════════════════════════════
    // STEP 4: CONFLICT MATRIX (buildSmartPrompt)
    // ═══════════════════════════════════════════════════
    const smartPrompt = buildSmartPrompt(garmentClass, outfitInfo);
    const strategy = outfitInfo?.currentType === "FULL_BODY" && (garmentClass === "UPPER_BODY" || garmentClass === "LOWER_BODY") ? "CONFLICT RESOLUTION" : "STANDARD";
    console.log(`\n\x1b[1m\x1b[35m▶ STEP 4: CONFLICT MATRIX [buildSmartPrompt]\x1b[0m`);
    console.log(`\x1b[90m  ℹ Determine try-on strategy and build the context-aware prompt for Gemini\x1b[0m`);
    console.log(`\x1b[36m    strategy:\x1b[0m          \x1b[1m\x1b[33m${strategy}\x1b[0m`);
    console.log(`\x1b[36m    garmentClass:\x1b[0m      ${garmentClass}`);
    console.log(`\x1b[36m    outfitType:\x1b[0m        ${outfitInfo.currentType}`);
    console.log(`\x1b[36m    prompt:\x1b[0m            ${smartPrompt.substring(0, 150)}...`);
    debugSteps.push({ step: "4", name: "CONFLICT MATRIX", model: "buildSmartPrompt", time: "0s", result: { strategy, garmentClass, outfitType: outfitInfo.currentType, prompt: smartPrompt } });

    // ═══════════════════════════════════════════════════
    // STEP 5: TRY-ON GENERATION (Gemini 2.5 Flash Image)
    // ═══════════════════════════════════════════════════
    let resultImage;
    if (provider === "gemini" && process.env.GEMINI_API_KEY) {
      console.log(`\n\x1b[1m\x1b[35m▶ STEP 5: TRY-ON GENERATION [Gemini 2.5 Flash Image]\x1b[0m`);
      console.log(`\x1b[90m  ℹ Generate the final try-on image — put the garment on the user's body\x1b[0m`);
      console.log(`\x1b[36m    sourceImage:\x1b[0m       ${sourceImage.length} chars (user body)`);
      console.log(`\x1b[36m    garmentImage:\x1b[0m      ${garmentImageForTryOn.length} chars (${garmentImageUsed})`);
      const s5 = Date.now();
      resultImage = await geminiVirtualTryOn(sourceImage, garmentImageForTryOn, garmentClass, outfitInfo);
      const s5t = ((Date.now() - s5) / 1000).toFixed(1);
      console.log(`\x1b[32m  ✓ STEP 5 COMPLETE\x1b[0m \x1b[90m(${s5t}s)\x1b[0m — result: ${resultImage ? resultImage.length : 0} chars`);
      debugSteps.push({ step: "5", name: "TRY-ON GENERATION", model: "Gemini 2.5 Flash Image", time: s5t + "s", result: { imageLength: resultImage ? resultImage.length : 0 } });
    } else {
      console.log(`\n\x1b[1m\x1b[35m▶ STEP 5: TRY-ON GENERATION [Nova Canvas]\x1b[0m`);
      console.log(`\x1b[90m  ℹ Generate the final try-on image — put the garment on the user's body\x1b[0m`);
      const s5 = Date.now();
      resultImage = await novaVirtualTryOn(sourceImage, garmentImageForTryOn, garmentClass, mergeStyle);
      const s5t = ((Date.now() - s5) / 1000).toFixed(1);
      console.log(`\x1b[32m  ✓ STEP 5 COMPLETE\x1b[0m \x1b[90m(${s5t}s)\x1b[0m — result: ${resultImage ? resultImage.length : 0} chars`);
      debugSteps.push({ step: "5", name: "TRY-ON GENERATION", model: "Nova Canvas", time: s5t + "s", result: { imageLength: resultImage ? resultImage.length : 0 } });
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n\x1b[1m\x1b[32m╔══════════════════════════════════════════════════════╗\x1b[0m`);
    console.log(`\x1b[1m\x1b[32m║         ✅ TRY-ON COMPLETE — ${totalTime}s total               ║\x1b[0m`);
    console.log(`\x1b[1m\x1b[32m╚══════════════════════════════════════════════════════╝\x1b[0m\n`);

    res.json({
      resultImage,
      garmentImageUsed,
      debug: {
        steps: debugSteps,
        garmentImageUsed,
        totalTime: totalTime + "s",
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
