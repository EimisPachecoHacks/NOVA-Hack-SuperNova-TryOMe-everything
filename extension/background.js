/**
 * NovaTryOnMe - Background Service Worker
 *
 * Routes messages between content scripts, popup, and the backend API.
 * Handles auth token injection for all API calls.
 */

const DEFAULT_BACKEND_URL = "http://localhost:3000";

async function getBackendUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["backendUrl"], (result) => {
      resolve(result.backendUrl || DEFAULT_BACKEND_URL);
    });
  });
}

/**
 * Get stored auth tokens if available.
 */
async function getAuthTokens() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["authTokens"], (result) => {
      resolve(result.authTokens || null);
    });
  });
}

/**
 * Build headers including auth token if available.
 */
async function buildHeaders() {
  const headers = { "Content-Type": "application/json" };
  const tokens = await getAuthTokens();
  if (tokens && tokens.idToken) {
    headers["Authorization"] = `Bearer ${tokens.idToken}`;
  }
  return headers;
}

/**
 * Try to refresh the auth token if we get a 401.
 */
async function tryRefreshToken() {
  const tokens = await getAuthTokens();
  if (!tokens || !tokens.refreshToken) return false;

  try {
    const backendUrl = await getBackendUrl();
    const resp = await fetch(`${backendUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    });
    if (!resp.ok) return false;
    const newTokens = await resp.json();
    await chrome.storage.local.set({
      authTokens: {
        ...tokens,
        idToken: newTokens.idToken,
        accessToken: newTokens.accessToken,
        expiresAt: Date.now() + (newTokens.expiresIn * 1000),
      },
    });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Forward a POST request to the backend with auth headers.
 */
async function apiPost(endpoint, data, retry = true) {
  const backendUrl = await getBackendUrl();
  const url = `${backendUrl}${endpoint}`;
  const headers = await buildHeaders();

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });

  if (response.status === 401 && retry) {
    const refreshed = await tryRefreshToken();
    if (refreshed) return apiPost(endpoint, data, false);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

/**
 * Forward a GET request to the backend with auth headers.
 */
async function apiGet(endpoint, retry = true) {
  const backendUrl = await getBackendUrl();
  const url = `${backendUrl}${endpoint}`;
  const headers = await buildHeaders();

  const response = await fetch(url, {
    method: "GET",
    headers,
  });

  if (response.status === 401 && retry) {
    const refreshed = await tryRefreshToken();
    if (refreshed) return apiGet(endpoint, false);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

/**
 * Forward a DELETE request to the backend with auth headers.
 */
async function apiDelete(endpoint, retry = true) {
  const backendUrl = await getBackendUrl();
  const url = `${backendUrl}${endpoint}`;
  const headers = await buildHeaders();

  const response = await fetch(url, {
    method: "DELETE",
    headers,
  });

  if (response.status === 401 && retry) {
    const refreshed = await tryRefreshToken();
    if (refreshed) return apiDelete(endpoint, false);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

/**
 * Forward a PUT request to the backend with auth headers.
 */
async function apiPut(endpoint, data, retry = true) {
  const backendUrl = await getBackendUrl();
  const url = `${backendUrl}${endpoint}`;
  const headers = await buildHeaders();

  const response = await fetch(url, {
    method: "PUT",
    headers,
    body: JSON.stringify(data),
  });

  if (response.status === 401 && retry) {
    const refreshed = await tryRefreshToken();
    if (refreshed) return apiPut(endpoint, data, false);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

async function proxyImageFetch(imageUrl) {
  const response = await fetch(imageUrl);
  const blob = await response.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function getStoredPhotos() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["bodyPhoto", "facePhoto"], (result) => {
      resolve({
        bodyPhoto: result.bodyPhoto || null,
        facePhoto: result.facePhoto || null,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case "GET_USER_PHOTOS": {
          const photos = await getStoredPhotos();
          sendResponse({ data: photos });
          break;
        }

        case "GET_AUTH_STATUS": {
          const tokens = await getAuthTokens();
          const isAuthenticated = !!(tokens && tokens.idToken);
          sendResponse({ data: { isAuthenticated } });
          break;
        }

        case "ANALYZE_PRODUCT": {
          const result = await apiPost("/api/analyze", {
            productImage: message.imageBase64,
            title: message.title,
            breadcrumbs: message.breadcrumbs,
          });
          sendResponse({ data: result });
          break;
        }

        case "TRY_ON": {
          const result = await apiPost("/api/try-on", {
            sourceImage: message.bodyImageBase64,
            referenceImage: message.garmentImageBase64,
            garmentClass: message.garmentClass,
            mergeStyle: message.mergeStyle || "SEAMLESS",
          });
          sendResponse({ data: result });
          break;
        }

        case "TRY_ON_COSMETICS": {
          const result = await apiPost("/api/cosmetics", {
            faceImage: message.faceImageBase64,
            cosmeticType: message.cosmeticType,
            color: message.color,
          });
          sendResponse({ data: result });
          break;
        }

        case "GENERATE_VIDEO": {
          const result = await apiPost("/api/video", {
            image: message.imageBase64,
            prompt: message.prompt,
          });
          sendResponse({ data: result });
          break;
        }

        case "GET_VIDEO_STATUS": {
          const provider = message.provider || "veo";
          const result = await apiGet(`/api/video/${message.jobId}?provider=${provider}`);
          sendResponse({ data: result });
          break;
        }

        case "REMOVE_BG": {
          const result = await apiPost("/api/image/remove-bg", {
            image: message.imageBase64,
          });
          sendResponse({ data: result });
          break;
        }

        case "SET_BACKEND_URL": {
          const newUrl = message.url;
          await chrome.storage.local.set({ backendUrl: newUrl });
          sendResponse({ data: { backendUrl: newUrl } });
          break;
        }

        case "SMART_SEARCH": {
          const result = await apiPost("/api/smart-search", {
            query: message.query,
          });
          sendResponse({ data: result });
          break;
        }

        case "PROXY_IMAGE": {
          const base64 = await proxyImageFetch(message.url);
          sendResponse({ data: base64 });
          break;
        }

        case "API_CALL": {
          const method = (message.method || "").toUpperCase();
          const endpoint = message.endpoint;
          let result;

          if (method === "PUT") {
            result = await apiPut(endpoint, message.data || {});
          } else if (method === "DELETE") {
            result = await apiDelete(endpoint);
          } else if (method === "GET" || !message.data || Object.keys(message.data).length === 0) {
            result = await apiGet(endpoint);
          } else {
            result = await apiPost(endpoint, message.data);
          }
          sendResponse({ data: result });
          break;
        }

        case "GET_PHOTOS": {
          const photos = await getStoredPhotos();
          sendResponse({ data: photos });
          break;
        }

        case "OPEN_POPUP": {
          // Open the side panel instead of popup
          if (_sender.tab) {
            await chrome.sidePanel.open({ tabId: _sender.tab.id });
          }
          sendResponse({ data: { opened: true } });
          break;
        }

        default:
          sendResponse({ error: `Unknown message type: ${message.type}` });
      }
    } catch (err) {
      console.error("[NovaTryOnMe background] Error:", err);
      sendResponse({ error: err.message });
    }
  })();

  return true;
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ tabId: tab.id });
});

// Also handle OPEN_POPUP messages from content script (now opens side panel)
// This is handled inside the message listener but we also set side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

console.log("[NovaTryOnMe] Background service worker started.");
