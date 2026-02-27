/**
 * NovaTryOnMe - Image Utility Functions
 *
 * Provides helpers for resizing, cropping, fetching, and converting images.
 * All functions work with base64-encoded strings.
 */

/**
 * Resize an image while maintaining its aspect ratio.
 *
 * @param {string} base64 - base64-encoded image (with or without data: prefix)
 * @param {number} maxWidth - Maximum width in pixels
 * @param {number} maxHeight - Maximum height in pixels
 * @returns {Promise<string>} Resized image as base64 JPEG (no data: prefix)
 */
async function resizeImage(base64, maxWidth, maxHeight) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // Calculate new dimensions preserving aspect ratio
      let { width, height } = img;
      const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      // Export as JPEG at 85% quality
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve(dataUrl.split(",")[1]);
    };
    img.onerror = () => reject(new Error("Failed to load image for resizing"));

    // Ensure the source has a data: prefix for the Image element
    img.src = base64.startsWith("data:")
      ? base64
      : `data:image/jpeg;base64,${base64}`;
  });
}

/**
 * Center-crop an image to a target aspect ratio, then resize to exact dimensions.
 * Useful for Nova Reel which requires exactly 1280x720.
 *
 * @param {string} base64 - base64-encoded image (with or without data: prefix)
 * @param {number} targetWidth - Desired output width in pixels
 * @param {number} targetHeight - Desired output height in pixels
 * @returns {Promise<string>} Cropped and resized image as base64 JPEG (no data: prefix)
 */
async function cropToAspectRatio(base64, targetWidth, targetHeight) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const srcW = img.width;
      const srcH = img.height;
      const targetRatio = targetWidth / targetHeight;
      const srcRatio = srcW / srcH;

      let cropX = 0;
      let cropY = 0;
      let cropW = srcW;
      let cropH = srcH;

      if (srcRatio > targetRatio) {
        // Source is wider than target ratio -> crop sides
        cropW = Math.round(srcH * targetRatio);
        cropX = Math.round((srcW - cropW) / 2);
      } else {
        // Source is taller than target ratio -> crop top/bottom
        cropH = Math.round(srcW / targetRatio);
        cropY = Math.round((srcH - cropH) / 2);
      }

      const canvas = document.createElement("canvas");
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(
        img,
        cropX,
        cropY,
        cropW,
        cropH,
        0,
        0,
        targetWidth,
        targetHeight
      );

      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve(dataUrl.split(",")[1]);
    };
    img.onerror = () =>
      reject(new Error("Failed to load image for cropping"));

    img.src = base64.startsWith("data:")
      ? base64
      : `data:image/jpeg;base64,${base64}`;
  });
}

/**
 * Fetch an image URL and convert it to a base64 string.
 * Tries a direct fetch first; if CORS blocks it, falls back to the
 * background.js proxy (PROXY_IMAGE message).
 *
 * @param {string} url - The image URL to fetch
 * @returns {Promise<string>} base64-encoded image data (no data: prefix)
 */
async function fetchImageAsBase64(url) {
  // Attempt 1: Direct fetch (works for same-origin or CORS-enabled URLs)
  try {
    const response = await fetch(url, { mode: "cors" });
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(",")[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    // Attempt 2: Proxy through background service worker
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "PROXY_IMAGE", url },
        (response) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          if (response && response.error) {
            return reject(new Error(response.error));
          }
          resolve(response.data);
        }
      );
    });
  }
}

/**
 * Convert a raw base64 string to a full data URL.
 *
 * @param {string} base64 - Raw base64 string (no prefix)
 * @param {string} [mimeType='image/jpeg'] - MIME type for the data URL
 * @returns {string} Complete data URL
 */
function base64ToDataUrl(base64, mimeType) {
  return `data:${mimeType || "image/jpeg"};base64,${base64}`;
}

/**
 * Convert a base64 string to a Blob.
 *
 * @param {string} base64 - Raw base64 string (no data: prefix)
 * @param {string} [mimeType='image/jpeg'] - MIME type for the blob
 * @returns {Blob} The resulting Blob object
 */
function base64ToBlob(base64, mimeType) {
  mimeType = mimeType || "image/jpeg";
  const byteString = atob(base64);
  const arrayBuffer = new ArrayBuffer(byteString.length);
  const uint8Array = new Uint8Array(arrayBuffer);

  for (let i = 0; i < byteString.length; i++) {
    uint8Array[i] = byteString.charCodeAt(i);
  }

  return new Blob([uint8Array], { type: mimeType });
}

/**
 * Convert a Blob to a base64 string.
 *
 * @param {Blob} blob - The Blob to convert
 * @returns {Promise<string>} base64 string (no data: prefix)
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // Strip the data:...;base64, prefix
      resolve(reader.result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
