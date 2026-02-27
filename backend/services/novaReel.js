const { StartAsyncInvokeCommand, GetAsyncInvokeCommand } = require("@aws-sdk/client-bedrock-runtime");
const { bedrockClient } = require("./bedrock");
const sharp = require("sharp");

/**
 * Generate a video from an image using Nova Reel
 * Returns the invocation ARN for polling status
 */
async function generateVideo(imageBase64, prompt) {
  console.log("[novaReel] generateVideo - starting async video generation");

  // Resize image to exactly 1280x720 as required by Nova Reel
  const imageBuffer = Buffer.from(imageBase64, "base64");
  const resizedBuffer = await sharp(imageBuffer)
    .resize(1280, 720, { fit: "cover" })
    .jpeg()
    .toBuffer();
  const resizedBase64 = resizedBuffer.toString("base64");

  console.log("[novaReel] generateVideo - image resized to 1280x720");

  const response = await bedrockClient.send(new StartAsyncInvokeCommand({
    modelId: "amazon.nova-reel-v1:1",
    modelInput: {
      taskType: "TEXT_VIDEO",
      textToVideoParams: {
        text: prompt || "Fashion model walking confidently on a runway, elegant pose, professional lighting, high fashion photography",
        images: [{ format: "jpeg", source: { bytes: resizedBase64 } }]
      },
      videoGenerationConfig: {
        durationSeconds: 6,
        fps: 24,
        dimension: "1280x720",
        seed: Math.floor(Math.random() * 2147483646)
      }
    },
    outputDataConfig: {
      s3OutputDataConfig: {
        s3Uri: `s3://${process.env.S3_BUCKET || "nova-tryonme-videos"}/videos/${Date.now()}`
      }
    }
  }));

  console.log(`[novaReel] generateVideo - job started, ARN: ${response.invocationArn}`);
  return response.invocationArn;
}

/**
 * Check the status of an async video generation job
 */
async function getVideoStatus(invocationArn) {
  console.log(`[novaReel] getVideoStatus - checking ARN: ${invocationArn}`);

  const response = await bedrockClient.send(new GetAsyncInvokeCommand({
    invocationArn: invocationArn
  }));

  const result = {
    status: response.status,
    failureMessage: response.failureMessage || null
  };

  if (response.status === "Completed") {
    const s3Uri = response.outputDataConfig.s3OutputDataConfig.s3Uri;
    result.videoUrl = s3Uri + "/output.mp4";
    // TODO: Generate presigned URL using S3 client
    console.log(`[novaReel] getVideoStatus - completed, video at: ${result.videoUrl}`);
  } else {
    console.log(`[novaReel] getVideoStatus - status: ${response.status}`);
  }

  return result;
}

module.exports = { generateVideo, getVideoStatus };
