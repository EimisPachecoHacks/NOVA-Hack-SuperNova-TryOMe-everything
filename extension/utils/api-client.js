/**
 * NovaTryOnMe - API Client
 *
 * Provides a clean interface for communicating with the NovaTryOnMe backend.
 * In content script context, all requests are routed through background.js
 * via chrome.runtime.sendMessage. Auth tokens are injected by background.js.
 */

class ApiClient {
  constructor(baseUrl = "http://localhost:3000") {
    this.baseUrl = baseUrl;
  }

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

  static call(endpoint, data) {
    return ApiClient._sendMessage({ type: "API_CALL", endpoint, data });
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

  static tryOn(bodyImageBase64, garmentImageBase64, garmentClass, mergeStyle = "SEAMLESS") {
    return ApiClient._sendMessage({
      type: "TRY_ON",
      bodyImageBase64,
      garmentImageBase64,
      garmentClass,
      mergeStyle,
    });
  }

  static tryOnCosmetics(faceImageBase64, cosmeticType, color) {
    return ApiClient._sendMessage({
      type: "TRY_ON_COSMETICS",
      faceImageBase64,
      cosmeticType,
      color,
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

  // ---------------------------------------------------------------------------
  // Instance methods (direct fetch, for use outside content scripts)
  // ---------------------------------------------------------------------------

  async post(endpoint, body) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  async get(endpoint) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API error ${response.status}: ${errorText}`);
    }

    return response.json();
  }
}
