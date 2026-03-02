const { ConverseCommand } = require("@aws-sdk/client-bedrock-runtime");
const { bedrockClient } = require("./bedrock");

/**
 * Detect image format from base64 string prefix.
 * Bedrock requires the correct format — hardcoding "jpeg" fails for PNG images.
 */
function detectImageFormat(base64String) {
  if (base64String.startsWith("iVBOR")) return "png";
  if (base64String.startsWith("/9j/")) return "jpeg";
  if (base64String.startsWith("UklG")) return "webp";
  return "jpeg"; // fallback
}

async function analyzeProduct(imageBase64, title, breadcrumbs) {
  const systemPrompt = `You are a product classification assistant for a virtual try-on shopping app.
Analyze the product image and information provided, then return a JSON response with the following structure:
{
  "category": "clothing" | "footwear" | "cosmetics" | "accessories" | "unsupported",
  "garmentClass": "UPPER_BODY" | "LOWER_BODY" | "FULL_BODY" | "FOOTWEAR" | null,
  "garmentSubClass": "LONG_SLEEVE_SHIRT" | "SHORT_SLEEVE_SHIRT" | "NO_SLEEVE_SHIRT" | "LONG_PANTS" | "SHORT_PANTS" | "LONG_DRESS" | "SHORT_DRESS" | "FULL_BODY_OUTFIT" | "SHOES" | "BOOTS" | null,
  "cosmeticType": "lipstick" | "eyeshadow" | "blush" | "foundation" | "eyeliner" | "mascara" | null,
  "color": "the primary color of the product",
  "styleTips": ["tip1", "tip2", "tip3"]
}

Classification rules:
- Shirts, jackets, hoodies, blouses, tops, sweaters, coats, crop tops → category: "clothing", garmentClass: "UPPER_BODY"
- Pants, jeans, skirts, shorts, leggings → category: "clothing", garmentClass: "LOWER_BODY"
- Dresses, jumpsuits, overalls, rompers (SINGLE connected garment only) → category: "clothing", garmentClass: "FULL_BODY"
- Shoes, boots, sandals, sneakers, heels → category: "footwear", garmentClass: "FOOTWEAR"
- Lipstick, lip gloss, lip color → category: "cosmetics", cosmeticType: "lipstick"
- Eye shadow, eye palette → category: "cosmetics", cosmeticType: "eyeshadow"
- Blush, bronzer, highlighter → category: "cosmetics", cosmeticType: "blush"
- Foundation, concealer, powder, BB cream → category: "cosmetics", cosmeticType: "foundation"
- Jewelry, watches, bags, hats → category: "accessories" (not yet supported for try-on)
- Everything else → category: "unsupported"

CRITICAL classification rule for TWO-PIECE SETS:
- If the image shows a MATCHING SET (top + bottom sold together as a pair), do NOT classify as FULL_BODY. Instead, classify based on the PRIMARY piece — usually UPPER_BODY if the title mentions "top", "shirt", "blouse", or LOWER_BODY if the title mentions "pants", "skirt", "shorts".
- FULL_BODY should ONLY be used for SINGLE connected garments (dresses, jumpsuits, rompers, overalls) — NOT for two separate pieces shown together.
- Always prioritize the product TITLE over the image when determining what the product is. If the title says "top" or "crop top", classify as UPPER_BODY even if the image shows matching pants.

For styleTips, provide 2-3 short, helpful fashion tips about how to style or wear this product.

IMPORTANT: Return ONLY valid JSON, no additional text.`;

  const response = await bedrockClient.send(new ConverseCommand({
    modelId: "us.amazon.nova-2-lite-v1:0",
    messages: [{
      role: "user",
      content: [
        {
          image: {
            format: detectImageFormat(imageBase64),
            source: { bytes: Buffer.from(imageBase64, "base64") }
          }
        },
        {
          text: `Product title: ${title}\nCategory path: ${breadcrumbs}\n\nAnalyze this product for virtual try-on classification. Return JSON only.`
        }
      ]
    }],
    system: [{ text: systemPrompt }],
    inferenceConfig: {
      maxTokens: 512,
      temperature: 0.1
    }
  }));

  // Extract the text response
  const responseText = response.output.message.content[0].text;

  // Parse JSON from response (handle potential markdown code blocks)
  let jsonStr = responseText;
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("Failed to parse Nova 2 Lite response:", responseText);
    // Fallback: try to extract JSON object from response
    const objectMatch = responseText.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }
    throw new Error("Failed to parse product analysis response");
  }
}

/**
 * Classify what the person is currently wearing in their photo.
 * Used to resolve clothing conflicts in virtual try-on.
 * Returns: { currentType: "FULL_BODY"|"UPPER_LOWER"|"OUTERWEAR", description: string }
 */
async function classifyOutfit(imageBase64) {
  const systemPrompt = `You are a fashion analysis assistant. Analyze what the person in the image is currently wearing and classify their outfit.

Return a JSON response with this structure:
{
  "currentType": "FULL_BODY" | "UPPER_LOWER" | "OUTERWEAR",
  "upperDescription": "description of upper body clothing or null",
  "lowerDescription": "description of lower body clothing or null",
  "fullDescription": "description of full body garment or null",
  "outerwearDescription": "description of outerwear or null"
}

Classification rules:
- FULL_BODY: Person is wearing a SINGLE PIECE garment that covers both upper and lower body. This includes: dresses, jumpsuits, rompers, playsuits, overalls, gowns, one-piece outfits, skort sets that are connected. IMPORTANT: If the top and bottom appear to be the SAME COLOR and SAME FABRIC/MATERIAL, it is very likely a single piece (dress, romper, playsuit) and should be classified as FULL_BODY.
- UPPER_LOWER: Person is wearing CLEARLY SEPARATE and DISTINCT top and bottom pieces that are DIFFERENT garments (e.g. a white shirt with blue jeans, a red blouse with a black skirt). The top and bottom must be visibly different items.
- OUTERWEAR: Person is wearing a coat, jacket, or blazer over other clothing

When in doubt between FULL_BODY and UPPER_LOWER, prefer FULL_BODY if the upper and lower pieces match in color/fabric.

For FULL_BODY: set fullDescription (e.g. "red floral dress", "black jumpsuit", "blue romper")
For UPPER_LOWER: set upperDescription (e.g. "white t-shirt") and lowerDescription (e.g. "blue jeans")
For OUTERWEAR: set outerwearDescription and also set what's underneath if visible

IMPORTANT: Return ONLY valid JSON, no additional text.`;

  const response = await bedrockClient.send(new ConverseCommand({
    modelId: "us.amazon.nova-2-lite-v1:0",
    messages: [{
      role: "user",
      content: [
        {
          image: {
            format: detectImageFormat(imageBase64),
            source: { bytes: Buffer.from(imageBase64, "base64") }
          }
        },
        {
          text: "Analyze what this person is currently wearing. Classify the outfit type and describe each piece. Return JSON only."
        }
      ]
    }],
    system: [{ text: systemPrompt }],
    inferenceConfig: {
      maxTokens: 256,
      temperature: 0.1
    }
  }));

  const responseText = response.output.message.content[0].text;

  let jsonStr = responseText;
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("Failed to parse outfit classification:", responseText);
    const objectMatch = responseText.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }
    // Fallback: assume separate top+bottom (safest default)
    console.warn("[novaLite] classifyOutfit: could not parse response, defaulting to UPPER_LOWER");
    return { currentType: "UPPER_LOWER", upperDescription: null, lowerDescription: null };
  }
}

/**
 * Detect if an image contains a person/model wearing the garment.
 * Used to decide if garment extraction is needed before try-on.
 */
async function hasPersonInImage(imageBase64) {
  const systemPrompt = `You are an image analysis assistant. Analyze the image and determine if it contains a person or human model wearing clothing.

Return a JSON response:
{
  "hasPerson": true | false,
  "garmentDescription": "brief description of the garment" | null
}

Rules:
- hasPerson: true if there is a visible person, human model, or mannequin wearing the garment
- hasPerson: false if the image shows ONLY a garment (flat lay, on hanger, product-only shot, no human body visible)
- garmentDescription: if hasPerson is true, describe the main garment (e.g. "blue denim jacket", "red floral dress")
- garmentDescription: null if hasPerson is false

IMPORTANT: Return ONLY valid JSON, no additional text.`;

  const response = await bedrockClient.send(new ConverseCommand({
    modelId: "us.amazon.nova-2-lite-v1:0",
    messages: [{
      role: "user",
      content: [
        {
          image: {
            format: detectImageFormat(imageBase64),
            source: { bytes: Buffer.from(imageBase64, "base64") }
          }
        },
        {
          text: "Does this image contain a person or model? Return JSON only."
        }
      ]
    }],
    system: [{ text: systemPrompt }],
    inferenceConfig: {
      maxTokens: 256,
      temperature: 0.1
    }
  }));

  const responseText = response.output.message.content[0].text;

  let jsonStr = responseText;
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    const objectMatch = responseText.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      return JSON.parse(objectMatch[0]);
    }
    return { hasPerson: false, garmentDescription: null };
  }
}

module.exports = { analyzeProduct, classifyOutfit, hasPersonInImage };
