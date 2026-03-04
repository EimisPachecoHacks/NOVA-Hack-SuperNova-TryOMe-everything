const express = require("express");
const router = express.Router();
const { virtualTryOn: novaVirtualTryOn, removeBackground } = require("../services/novaCanvas");
const { virtualTryOn: geminiVirtualTryOn, virtualTryOnOutfit: geminiOutfitTryOn, extractGarment, buildSmartPrompt } = require("../services/gemini");
const { analyzeProduct, classifyOutfit, hasPersonInImage } = require("../services/novaLite");

// ---------------------------------------------------------------------------
// Shared garment preprocessing — single source of truth for all try-on flows
// Detects model/person in garment image and extracts clean garment-only version
// Fallback chain: Gemini extraction → Nova Canvas BG removal → original
// ---------------------------------------------------------------------------
async function preprocessGarment(imageBase64, label = "garment") {
  const debugSteps = [];

  // Step A: Person detection
  let hasPerson = false;
  let garmentDescription = null;
  try {
    console.log(`\x1b[35m  [preprocess:${label}] Checking for person in image...\x1b[0m`);
    const s = Date.now();
    const result = await hasPersonInImage(imageBase64);
    hasPerson = result.hasPerson;
    garmentDescription = result.garmentDescription;
    const t = ((Date.now() - s) / 1000).toFixed(1);
    console.log(`\x1b[36m  [preprocess:${label}] hasPerson=${hasPerson} (${t}s)\x1b[0m`);
    debugSteps.push({ step: "person-detection", hasPerson, garmentDescription, time: t + "s" });
  } catch (err) {
    console.warn(`\x1b[31m  [preprocess:${label}] Person detection failed: ${err.message}\x1b[0m`);
    debugSteps.push({ step: "person-detection", error: err.message });
  }

  if (!hasPerson) {
    return { image: imageBase64, method: "original", debugSteps };
  }

  // Step B: Gemini garment extraction (primary)
  try {
    console.log(`\x1b[35m  [preprocess:${label}] Extracting garment via Gemini...\x1b[0m`);
    const s = Date.now();
    const extracted = await extractGarment(imageBase64, garmentDescription);
    const t = ((Date.now() - s) / 1000).toFixed(1);
    if (extracted && extracted.length > 100) {
      console.log(`\x1b[32m  [preprocess:${label}] Gemini extraction SUCCESS (${t}s) — ${extracted.length} chars\x1b[0m`);
      debugSteps.push({ step: "gemini-extraction", success: true, time: t + "s" });
      return { image: extracted, method: "extracted", debugSteps };
    }
    console.warn(`\x1b[33m  [preprocess:${label}] Gemini extraction returned empty (${t}s)\x1b[0m`);
    debugSteps.push({ step: "gemini-extraction", success: false, time: t + "s", reason: "empty result" });
  } catch (err) {
    console.warn(`\x1b[31m  [preprocess:${label}] Gemini extraction failed: ${err.message}\x1b[0m`);
    debugSteps.push({ step: "gemini-extraction", success: false, error: err.message });
  }

  // Step C: Nova Canvas background removal (fallback)
  try {
    console.log(`\x1b[35m  [preprocess:${label}] Fallback: Nova Canvas BG removal...\x1b[0m`);
    const s = Date.now();
    const bgRemoved = await removeBackground(imageBase64);
    const t = ((Date.now() - s) / 1000).toFixed(1);
    if (bgRemoved && bgRemoved.length > 100) {
      console.log(`\x1b[32m  [preprocess:${label}] BG removal SUCCESS (${t}s) — ${bgRemoved.length} chars\x1b[0m`);
      debugSteps.push({ step: "bg-removal", success: true, time: t + "s" });
      return { image: bgRemoved, method: "bg-removed", debugSteps };
    }
    console.warn(`\x1b[33m  [preprocess:${label}] BG removal returned empty (${t}s)\x1b[0m`);
    debugSteps.push({ step: "bg-removal", success: false, time: t + "s", reason: "empty result" });
  } catch (err) {
    console.warn(`\x1b[31m  [preprocess:${label}] BG removal failed: ${err.message}\x1b[0m`);
    debugSteps.push({ step: "bg-removal", success: false, error: err.message });
  }

  // All preprocessing failed — use original with warning
  console.warn(`\x1b[33m  [preprocess:${label}] ⚠ All preprocessing failed — using original image with model\x1b[0m`);
  return { image: imageBase64, method: "original-with-model", debugSteps };
}
const { optionalAuth } = require("../middleware/auth");
const { getProfile } = require("../services/dynamodb");
const { fetchPhotoFromS3 } = require("../services/s3");
const { buildCacheKey, buildOutfitCacheKey, getCached, setCached } = require("../services/tryOnCache");

const VALID_GARMENT_CLASSES = [
  "UPPER_BODY", "LOWER_BODY", "FULL_BODY", "FOOTWEAR", "ACCESSORY",
  "LONG_SLEEVE_SHIRT", "SHORT_SLEEVE_SHIRT", "NO_SLEEVE_SHIRT",
  "LONG_PANTS", "SHORT_PANTS", "LONG_DRESS", "SHORT_DRESS",
  "FULL_BODY_OUTFIT", "SHOES", "BOOTS",
  "EARRINGS", "NECKLACE", "BRACELET", "RING", "WATCH", "SUNGLASSES", "HAT"
];

// Accessory sub-classes that benefit from a face/close-up photo
const FACE_ACCESSORIES = ["EARRINGS", "NECKLACE", "SUNGLASSES"];
const ACCESSORY_SUB_CLASSES = ["EARRINGS", "NECKLACE", "BRACELET", "RING", "WATCH", "SUNGLASSES", "HAT"];


router.post("/", optionalAuth, async (req, res, next) => {
  try {
    let { sourceImage, referenceImage, garmentClass, mergeStyle, framing, poseIndex, quickMode } = req.body;

    // If authenticated and no sourceImage provided, fetch from S3
    if (!sourceImage && req.userId) {
      const profile = await getProfile(req.userId);
      if (profile) {
        // Use selected pose from generatedPhotoKeys, fallback to bodyPhotoKey
        const idx = typeof poseIndex === "number" ? Math.max(0, Math.min(poseIndex, (profile.generatedPhotoKeys || []).length - 1)) : 0;
        if (profile.generatedPhotoKeys && profile.generatedPhotoKeys.length > 0 && profile.generatedPhotoKeys[idx]) {
          sourceImage = await fetchPhotoFromS3(profile.generatedPhotoKeys[idx]);
        } else if (profile.bodyPhotoKey) {
          sourceImage = await fetchPhotoFromS3(profile.bodyPhotoKey);
        }
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
    console.log(`\x1b[36m  quickMode:\x1b[0m       \x1b[1m${!!quickMode}\x1b[0m`);
    console.log(`\x1b[36m  sourceImage:\x1b[0m     ${sourceImage ? sourceImage.length : 0} chars`);
    console.log(`\x1b[36m  referenceImage:\x1b[0m  ${referenceImage ? referenceImage.length : 0} chars`);
    console.log(`\x1b[36m  garmentClass:\x1b[0m    \x1b[1m${garmentClass || "(will detect)"}\x1b[0m`);
    console.log(`\x1b[36m  framing:\x1b[0m         \x1b[1m${framing || "full"}\x1b[0m`);
    console.log(`\x1b[36m  poseIndex:\x1b[0m       \x1b[1m${poseIndex}\x1b[0m`);

    // ═══════════════════════════════════════════════════
    // CACHE CHECK — skip all steps if same person+garment was generated before
    // ═══════════════════════════════════════════════════
    const cacheKey = buildCacheKey(req.userId, referenceImage, garmentClass, framing, poseIndex);
    const cachedResult = await getCached(cacheKey);
    if (cachedResult) {
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\x1b[1m\x1b[32m⚡ CACHE HIT — returning cached result (${totalTime}s)\x1b[0m`);

      // Still build size recommendation from profile
      let sizeRecommendation = null;
      if (req.userId) {
        try {
          const profile = await getProfile(req.userId);
          if (profile) {
            const isFootwear = (garmentClass || "").includes("FOOT") || (garmentClass || "").includes("SHOE") || (garmentClass || "").includes("BOOT");
            const isAccessory = garmentClass === "ACCESSORY" || ACCESSORY_SUB_CLASSES.includes(garmentClass);
            if (isFootwear && profile.shoesSize) {
              sizeRecommendation = { type: "shoes", size: profile.shoesSize, label: `Your shoe size: US ${profile.shoesSize}` };
            } else if (!isAccessory && profile.clothesSize) {
              sizeRecommendation = { type: "clothes", size: profile.clothesSize, label: `Your clothing size: ${profile.clothesSize}` };
              if (profile.sex) sizeRecommendation.label += ` (${profile.sex === "male" ? "Men's" : "Women's"})`;
            }
          }
        } catch (_) {}
      }

      const response = {
        resultImage: cachedResult,
        garmentImageUsed: "cached",
        cached: true,
        debug: { steps: [{ step: "cache", name: "CACHE HIT", time: totalTime + "s" }], garmentImageUsed: "cached", totalTime: totalTime + "s" },
      };
      if (sizeRecommendation) response.sizeRecommendation = sizeRecommendation;
      return res.json(response);
    }

    let garmentImageForTryOn = referenceImage;
    let garmentImageUsed = "original";
    let outfitInfo = { currentType: "UPPER_LOWER" };
    let analysisResult = null;

    if (quickMode && garmentClass) {
      // ═══════════════════════════════════════════════════
      // QUICK MODE — skip steps 1-4, jump straight to generation
      // Used for chained try-on calls where garmentClass is already known
      // ═══════════════════════════════════════════════════
      console.log(`\n\x1b[1m\x1b[36m⚡ QUICK MODE — skipping steps 1-4 (garmentClass: ${garmentClass})\x1b[0m`);
      debugSteps.push({ step: "1-4", name: "SKIPPED (quickMode)", model: "N/A", time: "0s", result: { quickMode: true, garmentClass } });
    } else {

    // ═══════════════════════════════════════════════════
    // STEP 1: PRODUCT ANALYSIS (Nova 2 Lite via Bedrock)
    // ═══════════════════════════════════════════════════
    analysisResult = null;
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
    if (!garmentClass || !VALID_GARMENT_CLASSES.includes(garmentClass)) {
      garmentClass = "UPPER_BODY";
    }

    // Normalize accessory sub-classes to ACCESSORY parent class
    if (ACCESSORY_SUB_CLASSES.includes(garmentClass)) {
      const detectedSubClass = garmentClass;
      garmentClass = "ACCESSORY";
      if (!analysisResult) analysisResult = {};
      analysisResult.garmentSubClass = detectedSubClass;
    }

    // For face accessories (earrings, necklaces, sunglasses), prefer a face photo
    if (garmentClass === "ACCESSORY" && analysisResult?.garmentSubClass && FACE_ACCESSORIES.includes(analysisResult.garmentSubClass) && req.userId) {
      try {
        const profile = await getProfile(req.userId);
        if (profile && profile.facePhotoKey) {
          console.log(`\x1b[36m  [accessory] Using face photo for ${analysisResult.garmentSubClass}\x1b[0m`);
          sourceImage = await fetchPhotoFromS3(profile.facePhotoKey);
        }
      } catch (err) {
        console.warn(`\x1b[33m  [accessory] Could not fetch face photo: ${err.message}\x1b[0m`);
      }
    }

    // ═══════════════════════════════════════════════════
    // STEP 2: GARMENT PREPROCESSING (shared pipeline)
    // Person detection → Gemini extraction → Nova BG removal fallback
    // Skip for accessories — extraction would extract clothing, not the accessory
    // ═══════════════════════════════════════════════════
    if (garmentClass === "ACCESSORY") {
      console.log(`\n\x1b[1m\x1b[35m▶ STEP 2: SKIPPED (accessory — use original product image)\x1b[0m`);
      garmentImageForTryOn = referenceImage;
      garmentImageUsed = "original";
      debugSteps.push({ step: "2", name: "GARMENT PREPROCESSING", time: "0s", result: { method: "skipped", reason: "accessory — extraction would extract clothing instead of accessory" } });
    } else {
      console.log(`\n\x1b[1m\x1b[35m▶ STEP 2: GARMENT PREPROCESSING [shared pipeline]\x1b[0m`);
      console.log(`\x1b[90m  ℹ Detect model in garment image and extract clean garment if needed\x1b[0m`);
      const s2 = Date.now();
      const preprocessed = await preprocessGarment(referenceImage, "garment");
      garmentImageForTryOn = preprocessed.image;
      garmentImageUsed = preprocessed.method;
      const s2t = ((Date.now() - s2) / 1000).toFixed(1);
      console.log(`\x1b[32m  ✓ STEP 2 COMPLETE\x1b[0m \x1b[90m(${s2t}s)\x1b[0m — method: \x1b[1m${garmentImageUsed}\x1b[0m`);
      debugSteps.push({ step: "2", name: "GARMENT PREPROCESSING", time: s2t + "s", result: { method: garmentImageUsed, substeps: preprocessed.debugSteps } });
    }

    // ═══════════════════════════════════════════════════
    // STEP 3: OUTFIT CLASSIFICATION (Nova 2 Lite via Bedrock)
    // Skip for accessories — no outfit conflict to resolve
    // ═══════════════════════════════════════════════════
    if (garmentClass === "ACCESSORY") {
      console.log(`\n\x1b[1m\x1b[35m▶ STEP 3: SKIPPED (accessory — no outfit conflict)\x1b[0m`);
      debugSteps.push({ step: "3", name: "OUTFIT CLASSIFICATION", model: "SKIPPED", time: "0s", result: { reason: "accessory" } });
    } else try {
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

    } // end of non-quickMode block

    // ═══════════════════════════════════════════════════
    // STEP 4: CONFLICT MATRIX (buildSmartPrompt)
    // ═══════════════════════════════════════════════════
    // Pass garmentSubClass through outfitInfo for accessory prompts
    if (garmentClass === "ACCESSORY" && analysisResult?.garmentSubClass) {
      outfitInfo.garmentSubClass = analysisResult.garmentSubClass;
    }
    const smartPrompt = buildSmartPrompt(garmentClass, outfitInfo, framing);
    const strategy = garmentClass === "ACCESSORY" ? "ACCESSORY" : (outfitInfo?.currentType === "FULL_BODY" && (garmentClass === "UPPER_BODY" || garmentClass === "LOWER_BODY") ? "CONFLICT RESOLUTION" : "STANDARD");
    console.log(`\n\x1b[1m\x1b[35m▶ STEP 4: CONFLICT MATRIX [buildSmartPrompt]\x1b[0m`);
    console.log(`\x1b[90m  ℹ Determine try-on strategy and build the context-aware prompt for Gemini\x1b[0m`);
    console.log(`\x1b[36m    strategy:\x1b[0m          \x1b[1m\x1b[33m${strategy}\x1b[0m`);
    console.log(`\x1b[36m    garmentClass:\x1b[0m      ${garmentClass}`);
    console.log(`\x1b[36m    outfitType:\x1b[0m        ${outfitInfo.currentType}`);
    console.log(`\x1b[36m    framing:\x1b[0m           \x1b[1m${framing || "full"}\x1b[0m`);
    console.log(`\x1b[36m    \x1b[1mFULL PROMPT:\x1b[0m`);
    console.log(`\x1b[33m    ${smartPrompt}\x1b[0m`);
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
      resultImage = await geminiVirtualTryOn(sourceImage, garmentImageForTryOn, garmentClass, outfitInfo, framing);
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

    // Build size/fit recommendation from user profile (#16)
    let sizeRecommendation = null;
    if (req.userId) {
      try {
        const profile = await getProfile(req.userId);
        if (profile) {
          const isFootwear = garmentClass === "FOOTWEAR" || garmentClass === "SHOES" || garmentClass === "BOOTS";
          const isAccessory = garmentClass === "ACCESSORY" || ACCESSORY_SUB_CLASSES.includes(garmentClass);

          if (isFootwear && profile.shoesSize) {
            sizeRecommendation = { type: "shoes", size: profile.shoesSize, label: `Your shoe size: US ${profile.shoesSize}` };
          } else if (!isAccessory && profile.clothesSize) {
            sizeRecommendation = { type: "clothes", size: profile.clothesSize, label: `Your clothing size: ${profile.clothesSize}` };
            if (profile.sex) {
              sizeRecommendation.label += ` (${profile.sex === "male" ? "Men's" : "Women's"})`;
            }
          }
        }
      } catch (err) {
        // Non-critical — don't fail the try-on if profile lookup fails
        console.warn(`[tryOn] Could not fetch profile for size recommendation: ${err.message}`);
      }
    }

    // Cache the result for future identical requests
    if (resultImage) {
      setCached(cacheKey, resultImage, req.userId).catch(() => {});
    }

    const response = {
      resultImage,
      garmentImageUsed,
      debug: {
        steps: debugSteps,
        garmentImageUsed,
        totalTime: totalTime + "s",
      },
    };
    if (sizeRecommendation) response.sizeRecommendation = sizeRecommendation;

    res.json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /outfit — Multi-garment try-on in a single Gemini call.
 * Body: { garments: [{ imageBase64, garmentClass, label }], framing, poseIndex }
 */
router.post("/outfit", optionalAuth, async (req, res, next) => {
  try {
    let { sourceImage, garments, framing, poseIndex } = req.body;

    if (!garments || !garments.length) {
      return res.status(400).json({ error: "garments array is required" });
    }

    // If no sourceImage, fetch from S3; also fetch face reference photos for identity
    let faceReferenceImages = [];
    if (!sourceImage && req.userId) {
      const profile = await getProfile(req.userId);
      if (profile) {
        const idx = typeof poseIndex === "number" ? poseIndex : 0;
        if (profile.generatedPhotoKeys && profile.generatedPhotoKeys[idx]) {
          sourceImage = await fetchPhotoFromS3(profile.generatedPhotoKeys[idx]);
        } else if (profile.bodyPhotoKey) {
          sourceImage = await fetchPhotoFromS3(profile.bodyPhotoKey);
        }
        // Fetch original face photos as identity anchors
        const faceKeys = (profile.originalPhotoKeys || []).filter((_, i) => i >= 3); // indices 3,4 are face photos
        for (const key of faceKeys) {
          try {
            const faceImg = await fetchPhotoFromS3(key);
            if (faceImg && faceImg.length > 100) faceReferenceImages.push(faceImg);
          } catch (_) {}
        }
        console.log(`\x1b[36m  faceReferences:\x1b[0m  ${faceReferenceImages.length} loaded`);
      }
    }

    if (!sourceImage) {
      return res.status(400).json({ error: "sourceImage is required (or be authenticated with photos)" });
    }

    // Strip data URI prefix
    if (sourceImage.startsWith("data:")) {
      sourceImage = sourceImage.split(",")[1];
    }
    garments.forEach((g) => {
      if (g.imageBase64 && g.imageBase64.startsWith("data:")) {
        g.imageBase64 = g.imageBase64.split(",")[1];
      }
    });

    const startTime = Date.now();

    console.log(`\n\x1b[1m\x1b[33m╔══════════════════════════════════════════════════════╗\x1b[0m`);
    console.log(`\x1b[1m\x1b[33m║        🔥 OUTFIT TRY-ON REQUEST (SINGLE CALL) 🔥     ║\x1b[0m`);
    console.log(`\x1b[1m\x1b[33m╚══════════════════════════════════════════════════════╝\x1b[0m`);
    console.log(`\x1b[36m  garments:\x1b[0m        \x1b[1m${garments.length}\x1b[0m`);
    garments.forEach((g, i) => {
      console.log(`\x1b[36m    [${i}]:\x1b[0m ${g.garmentClass} (${g.label}) — ${g.imageBase64?.length || 0} chars`);
    });
    console.log(`\x1b[36m  sourceImage:\x1b[0m     ${sourceImage.length} chars`);
    console.log(`\x1b[36m  framing:\x1b[0m         \x1b[1m${framing || "full"}\x1b[0m`);

    // ═══════════════════════════════════════════════════
    // CACHE CHECK — outfit try-on
    // ═══════════════════════════════════════════════════
    const outfitCacheKey = buildOutfitCacheKey(req.userId, garments, framing, poseIndex);
    const cachedOutfit = await getCached(outfitCacheKey);
    if (cachedOutfit) {
      const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`\x1b[1m\x1b[32m⚡ OUTFIT CACHE HIT — returning cached result (${totalTime}s)\x1b[0m`);
      return res.json({ resultImage: cachedOutfit, cached: true, totalTime: totalTime + "s" });
    }

    // Preprocess all garment images in parallel (same pipeline as single try-on)
    console.log(`\n\x1b[1m\x1b[35m▶ GARMENT PREPROCESSING [shared pipeline × ${garments.length}]\x1b[0m`);
    const preprocessResults = await Promise.all(
      garments.map((g) => preprocessGarment(g.imageBase64, g.label))
    );
    garments.forEach((g, i) => {
      g.imageBase64 = preprocessResults[i].image;
      console.log(`\x1b[36m    [${i}] ${g.label}:\x1b[0m method=\x1b[1m${preprocessResults[i].method}\x1b[0m`);
    });

    const resultImage = await geminiOutfitTryOn(sourceImage, garments, framing, faceReferenceImages);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n\x1b[1m\x1b[32m╔══════════════════════════════════════════════════════╗\x1b[0m`);
    console.log(`\x1b[1m\x1b[32m║      ✅ OUTFIT TRY-ON COMPLETE — ${totalTime}s total            ║\x1b[0m`);
    console.log(`\x1b[1m\x1b[32m╚══════════════════════════════════════════════════════╝\x1b[0m\n`);

    // Cache outfit result
    if (resultImage) {
      setCached(outfitCacheKey, resultImage, req.userId).catch(() => {});
    }

    res.json({ resultImage, totalTime: totalTime + "s" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
