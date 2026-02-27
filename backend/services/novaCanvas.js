const { InvokeModelCommand } = require("@aws-sdk/client-bedrock-runtime");
const { bedrockClient } = require("./bedrock");

/**
 * Virtual Try-On using Nova Canvas
 * Places a garment from referenceImage onto the person in sourceImage
 */
async function virtualTryOn(sourceImageBase64, referenceImageBase64, garmentClass, mergeStyle = "DETAILED") {
  console.log(`[novaCanvas] virtualTryOn - garmentClass: ${garmentClass}, mergeStyle: ${mergeStyle}`);

  const requestBody = {
    taskType: "VIRTUAL_TRY_ON",
    virtualTryOnParams: {
      sourceImage: sourceImageBase64,
      referenceImage: referenceImageBase64,
      maskType: "GARMENT",
      garmentBasedMask: {
        maskShape: "CONTOUR",
        garmentClass: garmentClass
      },
      maskExclusions: {
        preserveFace: "ON",
        preserveHands: "ON",
        preserveBodyPose: "ON"
      },
      mergeStyle: mergeStyle
    },
    imageGenerationConfig: {
      numberOfImages: 1,
      quality: "premium"
    }
  };

  const response = await bedrockClient.send(new InvokeModelCommand({
    modelId: "amazon.nova-canvas-v1:0",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(requestBody)
  }));

  const result = JSON.parse(new TextDecoder().decode(response.body));
  console.log(`[novaCanvas] virtualTryOn - success, got ${result.images.length} image(s)`);
  return result.images[0];
}

/**
 * Inpainting using Nova Canvas
 * Used for cosmetics try-on - applies makeup to specific facial regions
 */
async function inpaint(sourceImageBase64, maskPrompt, textPrompt) {
  console.log(`[novaCanvas] inpaint - maskPrompt: "${maskPrompt}", textPrompt: "${textPrompt}"`);

  const requestBody = {
    taskType: "INPAINTING",
    inPaintingParams: {
      image: sourceImageBase64,
      maskPrompt: maskPrompt,
      text: textPrompt
    },
    imageGenerationConfig: {
      numberOfImages: 1,
      quality: "premium"
    }
  };

  const response = await bedrockClient.send(new InvokeModelCommand({
    modelId: "amazon.nova-canvas-v1:0",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(requestBody)
  }));

  const result = JSON.parse(new TextDecoder().decode(response.body));
  console.log(`[novaCanvas] inpaint - success, got ${result.images.length} image(s)`);
  return result.images[0];
}

/**
 * Background removal using Nova Canvas
 */
async function removeBackground(imageBase64) {
  console.log("[novaCanvas] removeBackground - processing");

  const requestBody = {
    taskType: "BACKGROUND_REMOVAL",
    backgroundRemovalParams: {
      image: imageBase64
    }
  };

  const response = await bedrockClient.send(new InvokeModelCommand({
    modelId: "amazon.nova-canvas-v1:0",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(requestBody)
  }));

  const result = JSON.parse(new TextDecoder().decode(response.body));
  console.log("[novaCanvas] removeBackground - success");
  return result.images[0];
}

module.exports = { virtualTryOn, inpaint, removeBackground };
