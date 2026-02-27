const { GoogleGenAI } = require("@google/genai");
const sharp = require("sharp");

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
 * Generate video from image using Veo 3.1 Fast
 * Returns { operationName } for polling
 */
async function generateVideo(imageBase64, prompt) {
  console.log("[veo] generateVideo - starting video generation");

  const client = getClient();

  // Resize image to 1280x720 as required
  const imageBuffer = Buffer.from(imageBase64, "base64");
  const resizedBuffer = await sharp(imageBuffer)
    .resize(1280, 720, { fit: "cover" })
    .png()
    .toBuffer();

  console.log("[veo] generateVideo - image resized to 1280x720");

  // Upload image to Gemini Files API
  const uploadedFile = await client.files.upload({
    file: new Blob([resizedBuffer], { type: "image/png" }),
    config: { mimeType: "image/png" },
  });

  console.log(`[veo] generateVideo - file uploaded: ${uploadedFile.name}`);

  // Wait for file to be active
  let file = uploadedFile;
  while (file.state === "PROCESSING") {
    await new Promise((r) => setTimeout(r, 2000));
    file = await client.files.get({ name: file.name });
  }

  // Generate video
  const defaultPrompt = "Animate this exact photograph with very subtle, minimal motion. The person gently shifts their weight and there is a slight breeze. CRITICAL: Preserve the person's exact facial features, body proportions, skin tone, and lip shape exactly as shown. Do NOT add any objects, accessories, or items not already in the image. Do NOT remove any existing objects. Do NOT change the person's face, lips, eyes, or body shape. Keep the scene, lighting, clothing, and background exactly as they appear. Photorealistic, natural daylight, fashion photography.";
  const operation = await client.models.generateVideos({
    model: "veo-3.1-generate-preview",
    prompt: prompt || defaultPrompt,
    image: file,
    config: {
      aspectRatio: "16:9",
    },
  });

  console.log(`[veo] generateVideo - operation started: ${operation.name}`);
  return { operationName: operation.name, provider: "veo" };
}

/**
 * Check video generation status and return video data if complete
 */
async function getVideoStatus(operationName) {
  console.log(`[veo] getVideoStatus - checking: ${operationName}`);

  const client = getClient();
  const operation = await client.operations.get({ operation: operationName });

  const result = {
    status: operation.done ? "Completed" : "InProgress",
    failureMessage: null,
  };

  if (operation.done) {
    if (operation.error) {
      result.status = "Failed";
      result.failureMessage = operation.error.message;
      console.log(`[veo] getVideoStatus - failed: ${result.failureMessage}`);
    } else if (operation.response?.generatedVideos?.length > 0) {
      const video = operation.response.generatedVideos[0];
      // Download the video and return as base64
      const videoFile = video.video;
      const downloadedVideo = await client.files.download({ file: videoFile });
      // Convert to base64
      const chunks = [];
      for await (const chunk of downloadedVideo) {
        chunks.push(chunk);
      }
      const videoBuffer = Buffer.concat(chunks);
      result.videoBase64 = videoBuffer.toString("base64");
      result.videoMimeType = "video/mp4";
      console.log(`[veo] getVideoStatus - completed, video size: ${videoBuffer.length} bytes`);
    }
  } else {
    console.log(`[veo] getVideoStatus - in progress`);
  }

  return result;
}

module.exports = { generateVideo, getVideoStatus };
