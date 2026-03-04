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
 * Ensure the auth token is fresh. If it expires within 5 minutes, refresh proactively.
 */
async function ensureFreshToken() {
  const tokens = await getAuthTokens();
  if (!tokens || !tokens.idToken) return;

  // Refresh if token expires within 5 minutes (or expiresAt is missing)
  const bufferMs = 5 * 60 * 1000;
  if (tokens.expiresAt && Date.now() < tokens.expiresAt - bufferMs) return;

  console.log("[bg] Token expiring soon — proactively refreshing");
  await tryRefreshToken();
}

/**
 * Build headers including auth token if available.
 */
async function buildHeaders() {
  await ensureFreshToken();
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
  const result = await chrome.storage.local.get(["bodyPhoto", "selectedPoseIndex", "selectedFaceIndex"]);
  let bodyPhoto = result.bodyPhoto || null;
  let facePhoto = null;
  const selectedPoseIndex = result.selectedPoseIndex ?? 0;
  const selectedFaceIndex = result.selectedFaceIndex ?? 0;

  // Always fetch face photo fresh based on selectedFaceIndex (indices 3+ in originals)
  try {
    const allPhotos = await apiGet("/api/profile/photos/all");
    if (!bodyPhoto && allPhotos.generated && allPhotos.generated[selectedPoseIndex]) {
      bodyPhoto = allPhotos.generated[selectedPoseIndex];
      await chrome.storage.local.set({ bodyPhoto });
    }
    if (allPhotos.originals) {
      const facePhotos = allPhotos.originals.slice(3);
      const idx = Math.min(selectedFaceIndex, facePhotos.length - 1);
      facePhoto = facePhotos[idx] || allPhotos.originals[allPhotos.originals.length - 1] || null;
    }
  } catch (err) {
    console.warn("[background] Failed to fetch photos from backend:", err.message);
  }

  return { bodyPhoto, facePhoto, selectedPoseIndex };
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
          console.log(`[background] TRY_ON — framing: "${message.framing}", poseIndex: ${message.poseIndex}, garmentClass: "${message.garmentClass}"`);
          const result = await apiPost("/api/try-on", {
            sourceImage: message.bodyImageBase64,
            referenceImage: message.garmentImageBase64,
            garmentClass: message.garmentClass,
            mergeStyle: message.mergeStyle || "SEAMLESS",
            framing: message.framing || "full",
            poseIndex: message.poseIndex ?? 0,
            quickMode: message.quickMode || false,
          });
          sendResponse({ data: result });
          break;
        }

        case "TRY_ON_OUTFIT": {
          const result = await apiPost("/api/try-on/outfit", {
            sourceImage: message.bodyImageBase64 || null,
            garments: message.garments,
            framing: message.framing || "full",
            poseIndex: message.poseIndex ?? 0,
          });
          sendResponse({ data: result });
          break;
        }

        case "TRY_ON_COSMETICS": {
          const result = await apiPost("/api/cosmetics", {
            faceImage: message.faceImageBase64 || null,
            cosmeticType: message.cosmeticType,
            color: message.color,
            faceIndex: message.faceIndex ?? 0,
            productImage: message.productImage || null,
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

        // Voice Agent tool actions — forwarded from the voice agent page
        case "VOICE_SMART_SEARCH": {
          const searchUrl = chrome.runtime.getURL(
            `smart-search/results.html?q=${encodeURIComponent(message.query)}`
          );
          chrome.tabs.create({ url: searchUrl });
          sendResponse({ data: { opened: true } });
          break;
        }

        case "VOICE_BUILD_OUTFIT": {
          const outfitParams = new URLSearchParams();
          if (message.top) outfitParams.set("top", message.top);
          if (message.bottom) outfitParams.set("bottom", message.bottom);
          if (message.shoes) outfitParams.set("shoes", message.shoes);
          if (message.necklace) outfitParams.set("necklace", message.necklace);
          if (message.earrings) outfitParams.set("earrings", message.earrings);
          if (message.bracelets) outfitParams.set("bracelets", message.bracelets);
          if (message.sex) outfitParams.set("sex", message.sex);
          const outfitUrl = chrome.runtime.getURL(`outfit-builder/wardrobe.html?${outfitParams.toString()}`);
          chrome.tabs.create({ url: outfitUrl });
          sendResponse({ data: { opened: true } });
          break;
        }

        case "VOICE_ADD_TO_CART": {
          const productUrl = message.productUrl || "";
          const asinMatch = productUrl.match(/\/(?:dp|gp\/product)\/([A-Za-z0-9]{10})/);
          if (asinMatch) {
            const cartUrl = `https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=${asinMatch[1]}&Quantity.1=1`;
            chrome.tabs.create({ url: cartUrl });
          } else if (productUrl) {
            chrome.tabs.create({ url: productUrl });
          }
          sendResponse({ data: { opened: true } });
          break;
        }

        case "VOICE_TRY_ON": {
          // Navigate to the product URL if available, otherwise notify
          if (message.productUrl) {
            chrome.tabs.create({ url: message.productUrl });
          }
          sendResponse({ data: { opened: !!message.productUrl } });
          break;
        }

        case "VOICE_SAVE_FAVORITE": {
          // Read last try-on from storage and save as favorite
          const lastTryOn = (await chrome.storage.local.get("lastTryOn")).lastTryOn;
          if (!lastTryOn || !lastTryOn.resultImage) {
            sendResponse({ error: "No try-on result to save" });
            break;
          }
          const favResult = await apiPost("/api/favorites", {
            asin: lastTryOn.productId,
            productTitle: lastTryOn.productTitle,
            productImage: lastTryOn.productImage,
            productUrl: lastTryOn.productUrl,
            retailer: lastTryOn.retailer,
            category: lastTryOn.category,
            garmentClass: lastTryOn.garmentClass,
            tryOnResultImage: lastTryOn.resultImage,
          });
          sendResponse({ data: favResult });
          break;
        }

        case "VOICE_SAVE_VIDEO": {
          // Read last video from storage and save via API
          const lastVideo = (await chrome.storage.local.get("lastVideo")).lastVideo;
          if (!lastVideo) {
            sendResponse({ error: "No video to save" });
            break;
          }
          const saveResult = await apiPost("/api/video/save", {
            videoUrl: lastVideo.videoUrl,
            videoBase64: lastVideo.videoBase64,
            asin: lastVideo.productId,
            productTitle: lastVideo.productTitle,
            productImage: lastVideo.productImage,
          });
          sendResponse({ data: saveResult });
          break;
        }

        case "VOICE_ANIMATE": {
          // Read last try-on result and trigger video generation on active tab
          const tryOnData = (await chrome.storage.local.get("lastTryOn")).lastTryOn;
          if (!tryOnData || !tryOnData.resultImage) {
            sendResponse({ error: "No try-on result to animate" });
            break;
          }
          // Send to active tab's content script to click the Animate button
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (activeTab) {
            chrome.tabs.sendMessage(activeTab.id, { type: "VOICE_CLICK_ANIMATE" });
          }
          sendResponse({ data: { status: "ok" } });
          break;
        }

        case "VOICE_DOWNLOAD": {
          // Tell the active tab's content script to trigger download
          const [dlTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (dlTab) {
            chrome.tabs.sendMessage(dlTab.id, {
              type: "VOICE_CLICK_DOWNLOAD",
              downloadType: message.downloadType || "image",
            });
          }
          sendResponse({ data: { status: "ok" } });
          break;
        }

        case "VOICE_SEND": {
          // Tell the active tab's content script to trigger share
          const [shareTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (shareTab) {
            chrome.tabs.sendMessage(shareTab.id, { type: "VOICE_CLICK_SHARE" });
          }
          sendResponse({ data: { status: "ok" } });
          break;
        }

        case "VOICE_SELECT_SEARCH_ITEM": {
          const allTabs = await chrome.tabs.query({});
          const searchTab = allTabs
            .filter(t => t.url && t.url.includes("smart-search/results.html"))
            .sort((a, b) => b.id - a.id)[0];
          if (searchTab) {
            chrome.tabs.sendMessage(searchTab.id, {
              type: "VOICE_SELECT_SEARCH_ITEM",
              number: message.number,
            });
          }
          sendResponse({ data: { status: "ok" } });
          break;
        }

        case "VOICE_SELECT_OUTFIT_ITEMS": {
          const allTabs2 = await chrome.tabs.query({});
          const outfitTab = allTabs2
            .filter(t => t.url && t.url.includes("outfit-builder/wardrobe.html"))
            .sort((a, b) => b.id - a.id)[0];
          if (outfitTab) {
            chrome.tabs.sendMessage(outfitTab.id, {
              type: "VOICE_SELECT_OUTFIT_ITEMS",
              topNumber: message.topNumber,
              bottomNumber: message.bottomNumber,
              shoesNumber: message.shoesNumber,
            });
          }
          sendResponse({ data: { status: "ok" } });
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

// ---------------------------------------------------------------------------
// Context Menu — "Try On with SuperNova" on right-click any image
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "nova-tryon-image",
    title: "Try On with SuperNova TryOnMe",
    contexts: ["image"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "nova-tryon-image") return;
  const imageUrl = info.srcUrl;
  if (!imageUrl) return;

  console.log("[bg] Context menu try-on for image:", imageUrl?.substring(0, 80));

  // Check if content script is already injected (e.g. via manifest on supported sites)
  let alreadyInjected = false;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => !!window.__novaTryOnMeLoaded,
    });
    alreadyInjected = result?.result === true;
  } catch (_) {}

  if (!alreadyInjected) {
    // Inject the content script + CSS on unsupported sites
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["styles/content.css"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["utils/image-utils.js"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["utils/api-client.js"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    } catch (err) {
      console.warn("[bg] Failed to inject content scripts:", err.message);
    }
  }

  // Small delay to ensure content script is ready, then send the image URL
  const delay = alreadyInjected ? 100 : 500;
  setTimeout(() => {
    chrome.tabs.sendMessage(tab.id, {
      type: "CONTEXT_MENU_TRYON",
      imageUrl,
      pageUrl: info.pageUrl,
    }, () => {
      // Suppress "message channel closed" error — we don't need a response
      if (chrome.runtime.lastError) {
        console.warn("[bg] Context menu message:", chrome.runtime.lastError.message);
      }
    });
  }, delay);
});

console.log("[NovaTryOnMe] Background service worker started.");
