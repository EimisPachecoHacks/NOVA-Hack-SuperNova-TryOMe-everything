/**
 * NovaTryOnMe - Image Utility Functions
 *
 * Provides helpers for fetching and converting images.
 * All functions work with base64-encoded strings.
 */

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
    // If image is not JPEG/PNG (e.g. AVIF, WebP), convert to JPEG via canvas
    if (blob.type && !blob.type.match(/^image\/(jpeg|png)$/)) {
      return await convertBlobToJpegBase64(blob);
    }
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
 * Convert an image blob (AVIF, WebP, etc.) to JPEG base64 via canvas.
 * @param {Blob} blob
 * @returns {Promise<string>} base64-encoded JPEG (no prefix)
 */
function convertBlobToJpegBase64(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      URL.revokeObjectURL(objectUrl);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      resolve(dataUrl.split(",")[1]);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to decode image for conversion"));
    };
    img.src = objectUrl;
  });
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
 * Pad a face/cosmetics result image into a portrait-style frame.
 * Adds padding around the image so it appears as a proper portrait
 * (head + shoulders) instead of a tight face crop.
 *
 * @param {string} base64 - Raw base64 image string (no prefix)
 * @returns {Promise<string>} Padded image as raw base64 string
 */
function padToPortrait(base64) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;

      // Minimal padding to frame the face result
      const padX = Math.round(w * 0.05);
      const padTop = Math.round(h * 0.05);
      const padBottom = Math.round(h * 0.08);

      const canvasW = w + padX * 2;
      const canvasH = h + padTop + padBottom;

      const canvas = document.createElement("canvas");
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext("2d");

      // White background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvasW, canvasH);

      // Draw the original image centered with more room below (shoulders area)
      ctx.drawImage(img, padX, padTop);

      // Return as base64 without prefix
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      resolve(dataUrl.split(",")[1]);
    };
    img.src = base64ToDataUrl(base64);
  });
}

/**
 * Sample the average color from the edges of an image for background fill.
 */
function sampleEdgeColor(ctx, img, w, h) {
  const tempCanvas = document.createElement("canvas");
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tCtx = tempCanvas.getContext("2d", { willReadFrequently: true });
  tCtx.drawImage(img, 0, 0);

  let r = 0, g = 0, b = 0, count = 0;
  const samplePixel = (x, y) => {
    const d = tCtx.getImageData(x, y, 1, 1).data;
    r += d[0]; g += d[1]; b += d[2]; count++;
  };

  // Sample along all four edges
  for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 20))) {
    samplePixel(x, 0);
    samplePixel(x, h - 1);
  }
  for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 20))) {
    samplePixel(0, y);
    samplePixel(w - 1, y);
  }

  r = Math.round(r / count);
  g = Math.round(g / count);
  b = Math.round(b / count);
  return `rgb(${r},${g},${b})`;
}
