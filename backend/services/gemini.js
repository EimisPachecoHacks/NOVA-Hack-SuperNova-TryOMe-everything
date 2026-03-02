const { GoogleGenAI } = require("@google/genai");

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

let genaiClient = null;

function getClient() {
  if (!genaiClient) {
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set in environment variables");
    }
    genaiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  }
  return genaiClient;
}

/**
 * Build a smart try-on prompt based on outfit conflict resolution.
 *
 * @param {string} garmentClass - What the product is (UPPER_BODY, LOWER_BODY, FULL_BODY, FOOTWEAR)
 * @param {object} outfitInfo - Classification of what the person is currently wearing
 * @returns {string} The prompt to send to the image generation model
 */
function buildSmartPrompt(garmentClass, outfitInfo, framing) {
  const currentType = outfitInfo?.currentType || "UPPER_LOWER";

  // Half-body framing instruction (waist-up) — applicable to upper body garments and full body
  const upperBodyTypes = ["UPPER_BODY", "LONG_SLEEVE_SHIRT", "SHORT_SLEEVE_SHIRT", "NO_SLEEVE_SHIRT", "FULL_BODY", "LONG_DRESS", "SHORT_DRESS", "FULL_BODY_OUTFIT"];
  const isHalfBody = framing === "half" && upperBodyTypes.includes(garmentClass);
  let FRAMING_PREFIX = "";
  let FRAMING_SUFFIX;
  if (isHalfBody) {
    FRAMING_PREFIX = "MANDATORY FRAMING: Crop the output image at the waist. Show ONLY the upper body — head, torso, and arms. Do NOT show legs, knees, thighs, or feet under any circumstances. The bottom edge of the image must be at waist/hip level. ";
    FRAMING_SUFFIX = " REMINDER: Half-body crop at waist — no legs, no feet, no knees visible.";
  } else {
    FRAMING_PREFIX = "";
    FRAMING_SUFFIX = " Frame the output as a full-body photo showing the person from head to toe, including feet and shoes. Do not crop at the waist or knees.";
  }
  console.log(`\x1b[34m  [buildSmartPrompt] framing=${framing}, garmentClass=${garmentClass}, isHalfBody=${isHalfBody}\x1b[0m`);

  // Concise suffix — identity is handled via image labeling + system instruction in API call
  const STUDIO_SUFFIX =
    FRAMING_PREFIX +
    "CRITICAL: The output MUST be the EXACT same person from the first image — same face, same skin tone, same body, same hair. Do NOT generate a different person. " +
    "White studio background. Photorealistic. Output only the image." + FRAMING_SUFFIX;

  // --- No conflict cases ---

  // Trying on footwear: always simple
  if (garmentClass === "FOOTWEAR") {
    return `You are a professional virtual try-on system. Take the person in the first image and put on the footwear shown in the second image. Replace ONLY the shoes/footwear. IMPORTANT: Keep ALL clothing (shirt, pants, dress, etc.) EXACTLY the same — do NOT change any clothing item. ${STUDIO_SUFFIX}`;
  }

  // Trying on a full body garment (dress/jumpsuit): always replaces everything
  if (garmentClass === "FULL_BODY") {
    return `You are a professional virtual try-on system. Take the person in the first image and dress them in the full body garment (dress/jumpsuit) shown in the second image. Replace the ENTIRE outfit with this garment. ${STUDIO_SUFFIX}`;
  }

  // Person wearing separate top+bottom (no conflict for top or bottom)
  if (currentType === "UPPER_LOWER") {
    if (garmentClass === "UPPER_BODY") {
      return `You are a professional virtual try-on system. Take the person in the first image and replace ONLY their upper body clothing (shirt/top/blouse) with the garment shown in the second image. IMPORTANT: Keep the lower body clothing (pants/skirt/shorts) EXACTLY the same — do NOT change, replace, or alter the bottom clothing in any way. The bottom half must remain identical to the original photo. If the garment image shows matching pants or a set, IGNORE the pants — only use the top piece. ${STUDIO_SUFFIX}`;
    }
    if (garmentClass === "LOWER_BODY") {
      return `You are a professional virtual try-on system. Take the person in the first image and replace ONLY their lower body clothing (pants/skirt/shorts) with the garment shown in the second image. IMPORTANT: Keep the upper body clothing (shirt/top) EXACTLY the same — do NOT change, replace, or alter the top clothing in any way. The top half must remain identical to the original photo. ${STUDIO_SUFFIX}`;
    }
  }

  // --- Conflict cases: person wearing a dress/jumpsuit ---

  if (currentType === "FULL_BODY") {
    const fullDesc = outfitInfo.fullDescription || "dress";

    if (garmentClass === "UPPER_BODY") {
      // Trying a top on someone wearing a dress → need to generate matching bottom
      return `You are a professional virtual try-on system. The person in the first image is currently wearing a ${fullDesc}. Remove the ${fullDesc} entirely. Dress the person in the top/shirt shown in the second image on their upper body. If the garment is sheer or see-through, the skin underneath must be visible through the fabric just like in the reference. Since the ${fullDesc} is being removed, generate an appropriate matching bottom piece (such as jeans, pants, or a skirt) that complements the top in style, color, and fashion sense. The bottom should start where the top naturally ends. The complete outfit should look natural and fashionable. ${STUDIO_SUFFIX}`;
    }

    if (garmentClass === "LOWER_BODY") {
      // Trying pants/skirt on someone wearing a dress → need to generate matching top
      return `You are a professional virtual try-on system. The person in the first image is currently wearing a ${fullDesc}. Remove the ${fullDesc} entirely. Put the pants/skirt/shorts shown in the second image on the person's lower body. Since the ${fullDesc} is being removed, generate an appropriate matching top (such as a simple t-shirt, blouse, or fitted top) that complements the bottoms in style, color, and fashion sense. The complete outfit should look natural and fashionable. ${STUDIO_SUFFIX}`;
    }
  }

  // --- Outerwear cases ---

  if (currentType === "OUTERWEAR") {
    if (garmentClass === "UPPER_BODY") {
      return `You are a professional virtual try-on system. Take the person in the first image and remove any outerwear (coat/jacket). Replace their upper body clothing with the garment shown in the second image. IMPORTANT: Keep the lower body clothing EXACTLY the same — do NOT change the pants/skirt/shorts. ${STUDIO_SUFFIX}`;
    }
    if (garmentClass === "LOWER_BODY") {
      return `You are a professional virtual try-on system. Take the person in the first image and replace ONLY their lower body clothing with the garment shown in the second image. IMPORTANT: Keep the upper body clothing and outerwear EXACTLY the same — do NOT change the top or jacket. ${STUDIO_SUFFIX}`;
    }
  }

  // Fallback: generic try-on
  const garmentDescriptions = {
    UPPER_BODY: "upper body clothing (shirt/top/blouse/jacket)",
    LOWER_BODY: "lower body clothing (pants/shorts/skirt)",
    FULL_BODY: "full body outfit (dress/jumpsuit)",
    FOOTWEAR: "footwear (shoes/boots/sandals)",
  };
  const garmentDesc = garmentDescriptions[garmentClass] || "clothing";
  return `You are a professional virtual try-on system. Take the person in the first image and dress them in the garment shown in the second image. Replace ONLY the ${garmentDesc} with the garment from the second image. Keep all other clothing exactly the same. ${STUDIO_SUFFIX}`;
}

/**
 * Virtual Try-On using Gemini 2.5 Flash Image
 * Sends person image + garment image with a smart context-aware prompt
 * Returns base64 result image
 */
async function virtualTryOn(sourceImageBase64, referenceImageBase64, garmentClass, outfitInfo, framing) {
  console.log(`\x1b[1m\x1b[34m  ┌─── GEMINI VIRTUAL TRY-ON ───┐\x1b[0m`);
  console.log(`\x1b[34m  │ garmentClass:\x1b[0m \x1b[1m${garmentClass}\x1b[0m`);
  console.log(`\x1b[34m  │ outfitType:\x1b[0m   \x1b[1m${outfitInfo?.currentType || "UNKNOWN"}\x1b[0m`);
  console.log(`\x1b[34m  │ framing:\x1b[0m      \x1b[1m${framing || "full"}\x1b[0m`);
  console.log(`\x1b[34m  │ sourceImage:\x1b[0m  ${sourceImageBase64?.length || 0} chars`);
  console.log(`\x1b[34m  │ refImage:\x1b[0m     ${referenceImageBase64?.length || 0} chars`);

  const client = getClient();

  const prompt = buildSmartPrompt(garmentClass, outfitInfo, framing);
  const strategy = outfitInfo?.currentType === "FULL_BODY" && (garmentClass === "UPPER_BODY" || garmentClass === "LOWER_BODY") ? "CONFLICT RESOLUTION" : "STANDARD";
  console.log(`\x1b[34m  │ strategy:\x1b[0m     \x1b[1m\x1b[33m${strategy}\x1b[0m`);
  console.log(`\x1b[34m  │ \x1b[1mFULL PROMPT:\x1b[0m`);
  console.log(`\x1b[33m  │ ${prompt}\x1b[0m`);
  console.log(`\x1b[34m  └─── CALLING GEMINI API... ───┘\x1b[0m`);

  const response = await client.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [
      {
        role: "user",
        parts: [
          { text: "This is the person. Keep this EXACT person — same face, skin, body, hair:" },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: sourceImageBase64,
            },
          },
          { text: "This is the garment to put on the person above:" },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: referenceImageBase64,
            },
          },
          { text: prompt },
        ],
      },
    ],
    config: {
      responseModalities: ["TEXT", "IMAGE"],
      systemInstruction: "You are a virtual clothing try-on system. You will receive exactly 2 images: IMAGE 1 is a real person (the customer), IMAGE 2 is a garment. Your ONLY job is to produce a single photo-realistic image of the EXACT same person from IMAGE 1 wearing the garment from IMAGE 2. IDENTITY RULE: The output person must have the IDENTICAL face, facial bone structure, nose, eyes, eyebrows, lips, skin color, hair color, hair style, and body proportions as IMAGE 1. Do NOT replace them with a model, do NOT alter their facial features, do NOT change their skin tone. If you cannot preserve the identity perfectly, try harder — identity fidelity is the #1 priority, above all else.",
    },
  });

  // Extract the image from the response
  const candidates = response.candidates || [];
  if (!candidates.length) {
    throw new Error("No response from Gemini");
  }

  const parts = candidates[0].content?.parts || [];
  for (const part of parts) {
    if (part.inlineData) {
      console.log(`\x1b[32m  ✓ GEMINI RESPONSE RECEIVED\x1b[0m — image: ${part.inlineData.data.length} chars`);
      return part.inlineData.data;
    }
  }

  throw new Error("No image in Gemini response");
}

/**
 * Extract/isolate a garment from an image that contains a person/model.
 * Produces a clean garment-only image on a white background.
 */
async function extractGarment(imageBase64, garmentDescription) {
  console.log(`[gemini] ---- extractGarment START ----`);
  console.log(`[gemini] garmentDescription: ${garmentDescription}`);

  const client = getClient();

  const prompt = `You are a professional garment extraction system. The image shows a person/model wearing a garment${garmentDescription ? ` (${garmentDescription})` : ""}.

Your task: Generate a NEW image showing ONLY the garment by itself, completely removed from the person. The garment should be displayed as a clean, flat product shot on a plain white background — as if it were laid flat or photographed on an invisible mannequin.

CRITICAL RULES:
- Remove the person/model entirely — NO face, skin, hands, legs, or body parts should be visible
- Show ONLY the garment itself, preserving its exact color, pattern, texture, design details, and proportions
- Display the garment in a natural flat-lay or front-facing product orientation
- Use a clean, plain white background
- The garment should fill most of the frame
- Photorealistic result. Output only the resulting image.`;

  const response = await client.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: imageBase64,
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ["TEXT", "IMAGE"],
    },
  });

  const candidates = response.candidates || [];
  if (!candidates.length) {
    throw new Error("No response from Gemini for garment extraction");
  }

  const parts = candidates[0].content?.parts || [];
  for (const part of parts) {
    if (part.inlineData) {
      console.log(`[gemini] extractGarment - success, length=${part.inlineData.data.length}`);
      return part.inlineData.data;
    }
  }

  throw new Error("No image in Gemini garment extraction response");
}

/**
 * Generate a profile photo using multi-reference identity preservation.
 * Sends 5 user reference images + 1 pose template to gemini-3.1-flash-image-preview.
 *
 * @param {string[]} userImages - Array of 5 base64 strings [body1, body2, body3, face1, face2]
 * @param {string} poseTemplateBase64 - Base64 of the pose template image
 * @param {string} poseTemplateMime - MIME type of the pose template (default: "image/jpeg")
 * @returns {string} base64 result image
 */
async function generateProfilePhoto(userImages, poseTemplateBase64, poseTemplateMime = "image/jpeg", anchorImageBase64 = null, poseDescription = "") {
  const client = getClient();

  const hasAnchor = !!anchorImageBase64;
  const totalImages = hasAnchor ? 7 : 6;

  const prompt = `You are a professional portrait photography system specializing in identity-preserving image generation.

You will receive ${totalImages} images total:
- Images 1-3: Full body reference photos of a specific person (study body proportions, skin tone, hair)
- Images 4-5: Face close-up reference photos of the SAME person (study these VERY CAREFULLY — these define the exact face you must reproduce)${hasAnchor ? "\n- Image 6: A PREVIOUSLY GENERATED AI photo of this EXACT person. This is your PRIMARY identity reference. Your output MUST look like the SAME person as this anchor image — same face, same skin tone, same hair, same everything. If there is any conflict between the reference photos and this anchor, follow the anchor." : ""}
- Image ${hasAnchor ? "7" : "6"}: A white featureless MANNEQUIN showing the EXACT pose you must replicate${poseDescription ? ` — the mannequin is in a ${poseDescription}` : ""}

YOUR TASK: Generate a single new full-body photo of the EXACT person from the reference photos, placing them in the EXACT pose shown by the mannequin.${poseDescription ? ` The pose is: ${poseDescription}.` : ""}

IDENTITY RULES (CRITICAL — #1 PRIORITY — THIS IS THE MOST IMPORTANT RULE):
- The generated person MUST be IDENTICAL to the person in the reference photos${hasAnchor ? " and the anchor image" : ""}
- Face must match EXACTLY: same face shape, same jawline, same nose shape and size, same eye shape and color, same eyebrow shape, same lip shape, same skin color and tone, same hair color and style and length
- Body must match: same body type, same proportions, same height impression
- The person MUST have a natural, warm, friendly SMILE — not serious, not neutral${hasAnchor ? "\n- The anchor image (Image 6) is the DEFINITIVE reference for IDENTITY (face, skin, hair) ONLY. Do NOT copy the pose from the anchor — the pose must come ONLY from the mannequin." : ""}
- Do NOT create a different person under any circumstance
- The mannequin is a featureless white figure with NO identity. Take ZERO facial or body features from it — only copy its stance/position.

POSE RULES (CRITICAL — #2 PRIORITY):
- You MUST replicate the EXACT body position/stance of the mannequin${poseDescription ? ` (${poseDescription})` : ""}
- Do NOT default to a generic standing pose — study the mannequin carefully and match its arm positions, leg positions, weight distribution, and body angle${hasAnchor ? "\n- IGNORE the pose in the anchor image — the anchor is for identity ONLY. The mannequin defines the pose." : ""}

OUTPUT REQUIREMENTS:
- Person must be SMILING warmly and naturally
- Dress the person in: simple white fitted t-shirt and classic blue jeans
- Clean white/light gray studio background
- Professional studio lighting, soft shadows
- Full body visible from head to feet
- Photorealistic, high quality
- Output only the image`;

  // Build content array — order matters for identity preservation:
  // 1. Prompt  2. Body refs  3. Face close-ups (most important for identity)
  // 4. Anchor (if any)  5. Mannequin (last, least important)
  const contents = [
    { text: prompt },
    { text: "USER reference photo 1 (full body — study body proportions, skin tone, and hair):" },
    { inlineData: { mimeType: "image/jpeg", data: userImages[0] } },
    { text: "USER reference photo 2 (full body — same person, another angle, study body proportions, skin tone, and hair):" },
    { inlineData: { mimeType: "image/jpeg", data: userImages[1] } },
    { text: "USER reference photo 3 (full body — same person, another angle, study body proportions, skin tone, and hair):" },
    { inlineData: { mimeType: "image/jpeg", data: userImages[2] } },
    { text: "USER reference photo 4 (FACE CLOSE-UP — study this face carefully, you must reproduce it exactly):" },
    { inlineData: { mimeType: "image/jpeg", data: userImages[3] } },
    { text: "USER reference photo 5 (FACE CLOSE-UP — another angle of the same face, memorize every detail):" },
    { inlineData: { mimeType: "image/jpeg", data: userImages[4] } },
  ];

  if (anchorImageBase64) {
    contents.push(
      { text: "ANCHOR IMAGE (IDENTITY ONLY — copy the face, skin tone, and hair from this image, but do NOT copy the pose. The pose must come from the MANNEQUIN image below):" },
      { inlineData: { mimeType: "image/jpeg", data: anchorImageBase64 } },
    );
  }

  contents.push(
    { text: `MANNEQUIN — POSE REFERENCE (this is a featureless white mannequin, NOT a person. You MUST replicate this EXACT body stance/pose${poseDescription ? `: ${poseDescription}` : ""}. Take ZERO identity features from it):` },
    { inlineData: { mimeType: poseTemplateMime, data: poseTemplateBase64 } },
  );

  const response = await client.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: contents,
    config: {
      responseModalities: ["TEXT", "IMAGE"],
      imageConfig: { aspectRatio: "3:4" },
    },
  });

  const candidates = response.candidates || [];
  if (!candidates.length) {
    throw new Error("No response from Gemini for profile photo generation");
  }

  const parts = candidates[0].content?.parts || [];
  for (const part of parts) {
    if (part.inlineData) {
      return part.inlineData.data;
    }
  }

  throw new Error("No image in Gemini profile photo response");
}

/**
 * Virtual Try-On for a complete outfit in a SINGLE Gemini call.
 * Sends person image + all garment images at once.
 *
 * @param {string} sourceImageBase64 - The person's photo
 * @param {Array<{imageBase64: string, garmentClass: string, label: string}>} garments - Array of garments
 * @param {string} framing - "full" or "half"
 * @returns {string} base64 result image
 */
async function virtualTryOnOutfit(sourceImageBase64, garments, framing, faceReferenceImages = []) {
  console.log(`\x1b[1m\x1b[34m  ┌─── GEMINI OUTFIT TRY-ON (SINGLE CALL) ───┐\x1b[0m`);
  console.log(`\x1b[34m  │ garments:\x1b[0m     \x1b[1m${garments.length}\x1b[0m`);
  garments.forEach((g, i) => {
    console.log(`\x1b[34m  │   [${i}] ${g.garmentClass} (${g.label}) — ${g.imageBase64.length} chars\x1b[0m`);
  });
  console.log(`\x1b[34m  │ framing:\x1b[0m      \x1b[1m${framing || "full"}\x1b[0m`);
  console.log(`\x1b[34m  │ sourceImage:\x1b[0m  ${sourceImageBase64?.length || 0} chars`);
  console.log(`\x1b[34m  │ faceRefs:\x1b[0m     \x1b[1m${faceReferenceImages.length}\x1b[0m`);

  const client = getClient();

  const isHalfBody = framing === "half";
  const FRAMING = isHalfBody
    ? "Frame the output as a half-body photo from the waist up."
    : "Frame the output as a full-body photo showing the person from head to toe, including feet and shoes. Do not crop at the waist or knees.";

  const faceRefCount = faceReferenceImages.length;

  // Strategy: put garments FIRST, then identity photos LAST (closest to the generation prompt).
  // Gemini weights later content more heavily, so identity images near the prompt preserve identity better.

  const garmentLabelsSimple = garments.map((g, i) => `Garment ${i + 1}: ${g.label}`).join("\n");

  const prompt = `IDENTITY PRESERVATION IS YOUR #1 PRIORITY — MORE IMPORTANT THAN ANYTHING ELSE.

The person in the LAST ${1 + faceRefCount} image(s) is the customer. The output image MUST show this EXACT person — same face, same facial bone structure, same nose shape, same eye shape, same eyebrows, same lip shape, same skin color, same hair color, same hair style, same body type and proportions. Do NOT generate a model or a different person. Do NOT change their ethnicity or race. If you cannot preserve identity perfectly, try harder.

The first ${garments.length} image(s) are garments to dress this person in:
${garmentLabelsSimple}

Generate a single photorealistic image of the customer wearing ALL these garments as a complete outfit. White studio background. ${FRAMING}`;

  // Build contents array: GARMENTS first, then IDENTITY photos last (closest to prompt)
  const parts = [];

  // 1. Garment images first
  garments.forEach((g) => {
    parts.push({ text: `GARMENT — ${g.label} (clothing item only, NOT the person to use):` });
    parts.push({ inlineData: { mimeType: "image/jpeg", data: g.imageBase64 } });
  });

  // 2. Face reference photos
  faceReferenceImages.forEach((faceImg, i) => {
    parts.push({ text: `THE CUSTOMER'S FACE (reference ${i + 1}) — this is who the output must look like:` });
    parts.push({ inlineData: { mimeType: "image/jpeg", data: faceImg } });
  });

  // 3. Person body photo (last image, closest to prompt)
  parts.push({ text: "THE CUSTOMER — this is the person you must reproduce EXACTLY. Same face, same skin, same body, same hair. Dress this person in the garments above:" });
  parts.push({ inlineData: { mimeType: "image/jpeg", data: sourceImageBase64 } });

  // 4. Prompt last
  parts.push({ text: prompt });

  console.log(`\x1b[34m  └─── CALLING GEMINI API (single outfit call)... ───┘\x1b[0m`);

  const response = await client.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: ["TEXT", "IMAGE"],
      temperature: 0.4,
      personGeneration: "ALLOW_ADULT",
      systemInstruction: "You are a virtual clothing try-on system. Preserve the identity of the person in the reference images with absolute fidelity — same face geometry, skin tone, ethnicity, hair, and body. Do NOT substitute a different person or model.",
    },
  });

  const candidates = response.candidates || [];
  if (!candidates.length) {
    throw new Error("No response from Gemini for outfit try-on");
  }

  const responseParts = candidates[0].content?.parts || [];
  for (const part of responseParts) {
    if (part.inlineData) {
      console.log(`\x1b[32m  ✓ GEMINI OUTFIT RESPONSE RECEIVED\x1b[0m — image: ${part.inlineData.data.length} chars`);
      return part.inlineData.data;
    }
  }

  throw new Error("No image in Gemini outfit try-on response");
}

module.exports = { virtualTryOn, virtualTryOnOutfit, extractGarment, buildSmartPrompt, generateProfilePhoto };
