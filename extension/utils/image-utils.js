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
