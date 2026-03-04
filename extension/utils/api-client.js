/**
 * NovaTryOnMe - API Client
 *
 * Provides a clean interface for communicating with the NovaTryOnMe backend.
 * In content script context, all requests are routed through background.js
 * via chrome.runtime.sendMessage. Auth tokens are injected by background.js.
 */

class ApiClient {
  // ---------------------------------------------------------------------------
  // Static helpers for content-script usage (message passing through background)
  // ---------------------------------------------------------------------------

  static _sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (response && response.error) {
          return reject(new Error(response.error));
        }
        resolve(response.data);
      });
    });
  }

  // --- Product Analysis ---

  static analyzeProduct(imageBase64, title, breadcrumbs) {
    return ApiClient._sendMessage({
      type: "ANALYZE_PRODUCT",
      imageBase64,
      title,
      breadcrumbs,
    });
  }

  // --- Virtual Try-On ---

  static tryOn(bodyImageBase64, garmentImageBase64, garmentClass, mergeStyle = "SEAMLESS", framing = "full", poseIndex = 0) {
    return ApiClient._sendMessage({
      type: "TRY_ON",
      bodyImageBase64,
      garmentImageBase64,
      garmentClass,
      mergeStyle,
      framing,
      poseIndex,
    });
  }

  static tryOnCosmetics(faceImageBase64, cosmeticType, color, faceIndex, productImage) {
    return ApiClient._sendMessage({
      type: "TRY_ON_COSMETICS",
      faceImageBase64,
      cosmeticType,
      color,
      faceIndex,
      productImage,
    });
  }

  // --- Background Removal ---

  static removeBackground(imageBase64) {
    return ApiClient._sendMessage({
      type: "REMOVE_BG",
      imageBase64,
    });
  }

  // --- Video ---

  static generateVideo(imageBase64, prompt) {
    return ApiClient._sendMessage({
      type: "GENERATE_VIDEO",
      imageBase64,
      prompt,
    });
  }

  static getVideoStatus(jobId, provider) {
    return ApiClient._sendMessage({
      type: "GET_VIDEO_STATUS",
      jobId,
      provider,
    });
  }

  static saveVideo(videoUrl, videoBase64, asin, productTitle, productImage) {
    return ApiClient._sendMessage({
      type: "API_CALL",
      endpoint: "/api/video/save",
      method: "POST",
      data: { videoUrl, videoBase64, asin, productTitle, productImage },
    });
  }

  // --- Auth ---

  static getAuthStatus() {
    return ApiClient._sendMessage({ type: "GET_AUTH_STATUS" });
  }

  static signIn(email, password) {
    return ApiClient._sendMessage({
      type: "API_CALL",
      endpoint: "/api/auth/login",
      method: "POST",
      data: { email, password },
    });
  }

  static signUp(email, password) {
    return ApiClient._sendMessage({
      type: "API_CALL",
      endpoint: "/api/auth/signup",
      method: "POST",
      data: { email, password },
    });
  }

  static confirmEmail(email, code) {
    return ApiClient._sendMessage({
      type: "API_CALL",
      endpoint: "/api/auth/confirm",
      method: "POST",
      data: { email, code },
    });
  }

  static refreshToken(refreshToken) {
    return ApiClient._sendMessage({
      type: "API_CALL",
      endpoint: "/api/auth/refresh",
      method: "POST",
      data: { refreshToken },
    });
  }

  // --- Profile ---

  static getProfile() {
    return ApiClient._sendMessage({
      type: "API_CALL",
      endpoint: "/api/profile",
      method: "GET",
      data: {},
    });
  }

  static updateProfile(data) {
    return ApiClient._sendMessage({
      type: "API_CALL",
      endpoint: "/api/profile",
      method: "PUT",
      data,
    });
  }

  static uploadPhoto(type, image) {
    return ApiClient._sendMessage({
      type: "API_CALL",
      endpoint: "/api/profile/photos",
      method: "POST",
      data: { type, image },
    });
  }

  // --- Favorites ---

  static getFavorites() {
    return ApiClient._sendMessage({
      type: "API_CALL",
      endpoint: "/api/favorites",
      method: "GET",
      data: {},
    });
  }

  static addFavorite(data) {
    return ApiClient._sendMessage({
      type: "API_CALL",
      endpoint: "/api/favorites",
      method: "POST",
      data,
    });
  }

  static removeFavorite(asin) {
    return ApiClient._sendMessage({
      type: "API_CALL",
      endpoint: `/api/favorites/${encodeURIComponent(asin)}`,
      method: "DELETE",
      data: {},
    });
  }

  static checkFavorite(asin) {
    return ApiClient._sendMessage({
      type: "API_CALL",
      endpoint: `/api/favorites/${encodeURIComponent(asin)}`,
      method: "GET",
      data: {},
    });
  }

}
