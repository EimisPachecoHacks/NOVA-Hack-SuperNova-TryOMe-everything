/**
 * NovaTryOnMe - Content Script
 *
 * Injected into Amazon product pages. Orchestrates product analysis,
 * "Try It On" button injection, and the try-on panel experience.
 *
 * Dependencies (loaded before this file via manifest content_scripts):
 *   - utils/amazon-scraper.js  -> scrapeProductData()
 *   - utils/image-utils.js     -> fetchImageAsBase64(), base64ToDataUrl()
 *   - utils/api-client.js      -> ApiClient (static methods use message passing)
 */

(function () {
  "use strict";

  // Guard against double-injection
  if (window.__novaTryOnMeLoaded) return;
  window.__novaTryOnMeLoaded = true;

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let productData = null; // { imageUrl, title, breadcrumbs, asin, price }
  let productImageBase64 = null;
  let analysisResult = null; // Cached backend analysis response
  let panelOpen = false;
  let overlayCard = null; // The overlay element when open
  let currentPhotos = null; // Cached user photos for auto-refresh
  let currentIsCosmetic = false; // Cached cosmetic flag
  let lastImageUrl = null; // Track last image URL to detect real changes
  let tryOnEnabled = false; // Toggle switch state: when ON, swatch clicks auto-trigger try-on
  let currentFraming = 'full'; // half or full body framing
  let tryOnRequestId = 0; // Incremented per try-on call to prevent stale results

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------
  async function init() {
    console.log("[NovaTryOnMe] Content script initializing...");

    // Load framing preference from storage
    try {
      const stored = await chrome.storage.local.get(["tryOnFraming"]);
      if (stored.tryOnFraming) currentFraming = stored.tryOnFraming;
    } catch (_) {}

    // 1. Scrape the product page
    productData = scrapeProductData();
    if (!productData.imageUrl) {
      console.warn("[NovaTryOnMe] Could not find product image. Aborting.");
      return;
    }
    console.log("[NovaTryOnMe] Product scraped:", productData.title);

    // 2. Fetch the product image as base64
    try {
      productImageBase64 = await fetchImageAsBase64(productData.imageUrl);
    } catch (err) {
      console.error("[NovaTryOnMe] Failed to fetch product image:", err);
      return;
    }

    // 3. Analyze the product via the backend (Nova 2 Lite)
    try {
      analysisResult = await ApiClient.analyzeProduct(
        productImageBase64,
        productData.title,
        productData.breadcrumbs
      );
      console.log("[NovaTryOnMe] Analysis result:", analysisResult);
    } catch (err) {
      console.error("[NovaTryOnMe] Product analysis failed:", err);
      // Still inject the button so the user can retry
    }

    // 4. Only inject the button if the product is a supported category
    if (analysisResult && analysisResult.supported === false) {
      console.log("[NovaTryOnMe] Product not supported for try-on.");
      return;
    }

    // 5. Inject UI elements
    injectTryOnButton();

    // 6. Watch for color/variation swatch changes
    setupVariationObserver();
  }

  // ---------------------------------------------------------------------------
  // Listen for pose/framing changes from the side panel
  // ---------------------------------------------------------------------------
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;

    if (changes.tryOnFraming) {
      currentFraming = changes.tryOnFraming.newValue || 'full';
      console.log("[NovaTryOnMe] Framing changed to:", currentFraming);
    }

    // Re-trigger try-on if overlay is open and pose or framing changed
    if ((changes.selectedPoseIndex || changes.tryOnFraming) && overlayCard && currentPhotos) {
      console.log("[NovaTryOnMe] Pose/framing changed — re-triggering try-on");
      performTryOn(overlayCard, currentPhotos, currentIsCosmetic);
    }
  });

  // ---------------------------------------------------------------------------
  // "Try It On" Button
  // ---------------------------------------------------------------------------
  function injectTryOnButton() {
    // Guard: don't inject a duplicate button
    if (document.querySelector(".nova-tryon-btn")) return;

    // Use #imageBlock as anchor — it is STABLE and never replaced by Amazon's
    // Twister system (unlike #imgTagWrapperId which gets destroyed on swatch change).
    const anchor =
      document.querySelector("#imageBlock") ||
      document.querySelector("#leftCol");

    if (!anchor) {
      console.warn("[NovaTryOnMe] No anchor element found for button.");
      return;
    }

    // Ensure relative positioning so absolute button works
    const anchorStyle = window.getComputedStyle(anchor);
    if (anchorStyle.position === "static") {
      anchor.style.position = "relative";
    }

    const btn = document.createElement("button");
    btn.className = "nova-tryon-btn nova-tryon-btn--pulse";
    btn.innerHTML = '<span class="nova-tryon-btn-icon">&#10024;</span> Try It On';
    btn.setAttribute("aria-label", "Virtual Try-On with SuperNova TryOnMe");

    // Tooltip element (hidden by default)
    const tooltip = document.createElement("div");
    tooltip.className = "nova-tryon-tooltip";
    tooltip.textContent = "Please upload your photos first";
    btn.appendChild(tooltip);

    btn.addEventListener("click", handleTryOnClick);

    // Insert as direct child of #imageBlock — this survives swatch changes
    anchor.appendChild(btn);
    console.log("[NovaTryOnMe] Try-On button injected into #imageBlock.");
  }

  // ---------------------------------------------------------------------------
  // Button Click Handler (Toggle Switch: ON/OFF)
  // ---------------------------------------------------------------------------
  async function handleTryOnClick(e) {
    const btn = e.currentTarget;
    const tooltip = btn.querySelector(".nova-tryon-tooltip");

    // If already enabled, toggle OFF
    if (tryOnEnabled) {
      disableTryOn(btn);
      return;
    }

    // --- Turning ON: validate auth and photos first ---

    // Check if user is authenticated
    try {
      const authStatus = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "GET_AUTH_STATUS" }, (res) => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          resolve(res && res.data ? res.data : { isAuthenticated: false });
        });
      });

      if (!authStatus.isAuthenticated) {
        tooltip.textContent = "Please sign in to use Try-On";
        tooltip.classList.add("nova-tryon-tooltip--visible");
        setTimeout(() => tooltip.classList.remove("nova-tryon-tooltip--visible"), 3000);
        chrome.runtime.sendMessage({ type: "OPEN_POPUP" });
        return;
      }
    } catch (_) {
      // If GET_AUTH_STATUS fails, proceed anyway for backward compat
    }

    // Check if user has uploaded photos
    let photos;
    try {
      photos = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "GET_USER_PHOTOS" }, (res) => {
          if (chrome.runtime.lastError) {
            return reject(new Error(chrome.runtime.lastError.message));
          }
          resolve(res && res.data ? res.data : { bodyPhoto: null, facePhoto: null });
        });
      });
    } catch (err) {
      console.error("[NovaTryOnMe] Failed to check user photos:", err);
      photos = { bodyPhoto: null, facePhoto: null };
    }

    // Determine if this is a cosmetics product
    const isCosmetic =
      analysisResult &&
      analysisResult.category &&
      analysisResult.category.toLowerCase().includes("cosmetic");

    // Check for the appropriate photo type
    const requiredPhoto = isCosmetic ? photos.facePhoto : photos.bodyPhoto;

    if (!requiredPhoto) {
      tooltip.classList.add("nova-tryon-tooltip--visible");
      setTimeout(() => tooltip.classList.remove("nova-tryon-tooltip--visible"), 3000);
      chrome.runtime.sendMessage({ type: "OPEN_POPUP" });
      return;
    }

    // --- All checks passed: enable try-on mode ---
    enableTryOn(btn, photos, isCosmetic);
  }

  /**
   * Enable try-on mode: switch button to ON state, open overlay, trigger first try-on.
   */
  function enableTryOn(btn, photos, isCosmetic) {
    tryOnEnabled = true;
    currentPhotos = photos;
    currentIsCosmetic = isCosmetic;

    // Update button appearance to "ON" state
    btn.classList.add("nova-tryon-btn--active");
    btn.classList.remove("nova-tryon-btn--pulse");
    btn.innerHTML = '<span class="nova-tryon-btn-icon">&#10024;</span> Try On: ON';
    // Re-add tooltip
    const tooltip = document.createElement("div");
    tooltip.className = "nova-tryon-tooltip";
    tooltip.textContent = "Click to disable auto try-on";
    btn.appendChild(tooltip);

    console.log("[NovaTryOnMe] Try-on mode ENABLED");

    // Open overlay with first try-on
    if (!panelOpen) {
      openOverlay(photos, isCosmetic);
    }
  }

  /**
   * Disable try-on mode: switch button to OFF state, close overlay.
   */
  function disableTryOn(btn) {
    tryOnEnabled = false;

    // Update button appearance back to "OFF" state
    btn.classList.remove("nova-tryon-btn--active");
    btn.classList.add("nova-tryon-btn--pulse");
    btn.innerHTML = '<span class="nova-tryon-btn-icon">&#10024;</span> Try It On';
    // Re-add tooltip
    const tooltip = document.createElement("div");
    tooltip.className = "nova-tryon-tooltip";
    tooltip.textContent = "Please upload your photos first";
    btn.appendChild(tooltip);

    console.log("[NovaTryOnMe] Try-on mode DISABLED");

    // Close the overlay (don't double-disable toggle since we already set it to false above)
    closeOverlay(false);
  }

  // ---------------------------------------------------------------------------
  // Try-On Overlay (on top of product image)
  // ---------------------------------------------------------------------------
  function openOverlay(photos, isCosmetic) {
    panelOpen = true;

    // Find the product image container (use a large container, not the tiny img wrapper)
    const imageContainer =
      document.querySelector("#imageBlock") ||
      document.querySelector("#leftCol") ||
      document.querySelector("#imgTagWrapperId");

    if (!imageContainer) {
      console.warn("[NovaTryOnMe] No image container found for overlay.");
      return;
    }

    // Ensure relative positioning so absolute overlay works
    const containerStyle = window.getComputedStyle(imageContainer);
    if (containerStyle.position === "static") {
      imageContainer.style.position = "relative";
    }

    // Create overlay card
    const card = document.createElement("div");
    card.className = "nova-tryon-overlay-card";
    card.innerHTML = `
      <div class="nova-tryon-overlay-header">
        <h3>SuperNova TryOnMe</h3>
        <button class="nova-tryon-overlay-close" aria-label="Close">&times;</button>
      </div>
      <div class="nova-tryon-overlay-body">
        <div class="nova-tryon-loading">
          <div class="nova-tryon-spinner"></div>
          <div class="nova-tryon-loading-text">Generating your virtual try-on...</div>
          <div class="nova-tryon-loading-subtext">This may take a few seconds</div>
          <div class="nova-tryon-loading-timer" id="tryOnElapsedTimer">0.0s</div>
        </div>
      </div>
    `;

    imageContainer.appendChild(card);
    overlayCard = card;

    // Close handler — user explicitly closing = disable toggle
    const closeBtn = card.querySelector(".nova-tryon-overlay-close");
    closeBtn.addEventListener("click", () => closeOverlay(true));

    // Escape key closes overlay and disables toggle
    const escHandler = (e) => {
      if (e.key === "Escape") {
        closeOverlay(true);
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);

    // Start the try-on request
    performTryOn(card, photos, isCosmetic);
  }

  /**
   * Close the overlay card.
   * @param {boolean} disableToggle - If true, also turns off the try-on toggle (e.g. user clicked X).
   */
  function closeOverlay(disableToggle = false) {
    panelOpen = false;
    if (overlayCard) {
      overlayCard.remove();
      overlayCard = null;
    }
    // Clean up any open lightbox
    const lightbox = document.getElementById("nova-tryon-lightbox");
    if (lightbox) lightbox.remove();
    // Clear debug images from storage to free memory
    chrome.storage.local.remove(["tryOnDebug"]);
    if (disableToggle && tryOnEnabled) {
      tryOnEnabled = false;
      const btn = document.querySelector(".nova-tryon-btn");
      if (btn) {
        btn.classList.remove("nova-tryon-btn--active");
        btn.classList.add("nova-tryon-btn--pulse");
        btn.innerHTML = '<span class="nova-tryon-btn-icon">&#10024;</span> Try It On';
        const tooltip = document.createElement("div");
        tooltip.className = "nova-tryon-tooltip";
        tooltip.textContent = "Please upload your photos first";
        btn.appendChild(tooltip);
      }
      console.log("[NovaTryOnMe] Try-on mode DISABLED (overlay closed by user)");
    }
  }

  // ---------------------------------------------------------------------------
  // Store debug images in chrome.storage so the popup panel can display them
  // ---------------------------------------------------------------------------
  function storeDebugImages(bodyPhotoBase64, garmentBase64, debugInfo) {
    const userPhoto = bodyPhotoBase64.startsWith("data:") ? bodyPhotoBase64 : "data:image/jpeg;base64," + bodyPhotoBase64;
    const garmentPhoto = garmentBase64.startsWith("data:") ? garmentBase64 : "data:image/jpeg;base64," + garmentBase64;
    chrome.storage.local.set({
      tryOnDebug: {
        userPhoto,
        garmentPhoto,
        garmentImageUsed: debugInfo.garmentImageUsed || "original",
        timestamp: Date.now(),
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Try-On API Request
  // ---------------------------------------------------------------------------
  // Shared helper: log backend debug steps to browser console
  function logDebugSteps(debug) {
    if (!debug || !debug.steps) return;
    const S = "background:#FF9900;color:#000;font-weight:bold;padding:2px 6px;border-radius:3px;";
    const DESC = {
      "1": "Analyze the product image to detect garment type, color, and category",
      "2": "Check if the product image contains a person/model wearing the garment",
      "2.1": "Extract the garment from the model photo into a clean white-background image",
      "3": "Classify what the USER is currently wearing (top+bottom, dress, outerwear) to handle outfit conflicts",
      "4": "Determine try-on strategy and build the context-aware prompt for Gemini",
      "5": "Generate the final try-on image using AI image generation",
    };
    debug.steps.forEach((s) => {
      const desc = DESC[s.step] || "";
      const summary = s.result && s.result.error
        ? "FAILED: " + s.result.error
        : JSON.stringify(s.result).substring(0, 200);
      console.log(
        `%c STEP ${s.step}: ${s.name} %c [${s.model}] %c ${desc}`,
        S, "color:#4FC3F7;font-weight:bold;", "color:#aaa;font-style:italic;"
      );
      console.log(
        `%c   → %c ${summary} %c(${s.time})`,
        "color:#FF9900;font-weight:bold;", "color:#ccc;", "color:#888;"
      );
    });
    console.log(
      `%c PIPELINE COMPLETE %c Total: ${debug.totalTime} | Garment: ${debug.garmentImageUsed}`,
      "background:#4CAF50;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px;font-size:13px;",
      "color:#4CAF50;font-weight:bold;font-size:13px;"
    );
  }

  async function performTryOn(card, photos, isCosmetic) {
    const body = card && card.querySelector ? card.querySelector(".nova-tryon-overlay-body") : null;
    if (!body) {
      console.warn("[NovaTryOnMe] performTryOn: no overlay body found, skipping.");
      return;
    }

    // Concurrency guard: each call gets an ID; if a newer call starts, older ones stop updating the UI
    const thisRequestId = ++tryOnRequestId;

    console.log(
      "%c 🔥 TRY-ON START %c " + (isCosmetic ? "COSMETIC" : "CLOTHING") + " (req#" + thisRequestId + ")",
      "background:#FF6600;color:#fff;font-weight:bold;padding:4px 8px;border-radius:4px;font-size:14px;",
      "color:#FF6600;font-weight:bold;font-size:14px;"
    );

    // Start elapsed timer
    const tryOnStart = Date.now();
    const timerEl = body.querySelector("#tryOnElapsedTimer");
    const timerInterval = setInterval(() => {
      if (timerEl) timerEl.textContent = ((Date.now() - tryOnStart) / 1000).toFixed(1) + "s";
    }, 100);

    try {
      let resultImage;
      let debugInfo = null;

      // Read selected pose index (stored locally, backend fetches actual image from S3)
      const currentPoseIdx = await new Promise((resolve) => {
        chrome.storage.local.get(["selectedPoseIndex"], (r) => resolve(r.selectedPoseIndex || 0));
      });

      if (isCosmetic) {
        const response = await ApiClient.tryOnCosmetics(
          photos.facePhoto,
          analysisResult.cosmeticType || "lipstick",
          analysisResult.color || null
        );
        resultImage = response.resultImage;
      } else {
        // Send null as bodyImage so backend fetches the correct pose from S3 using poseIndex
        console.log(`[NovaTryOnMe] Try-on params — poseIdx: ${currentPoseIdx}, framing: "${currentFraming}" (type: ${typeof currentFraming}), garmentClass: ${analysisResult ? analysisResult.garmentClass : 'null'}`);
        const response = await ApiClient.tryOn(
          null,
          productImageBase64,
          analysisResult ? analysisResult.garmentClass : null,
          "SEAMLESS",
          currentFraming,
          currentPoseIdx
        );
        resultImage = response.resultImage;
        debugInfo = response.debug;

        // Log all backend pipeline steps
        logDebugSteps(debugInfo);
      }

      // If a newer try-on was started while we were waiting, discard this result
      if (thisRequestId !== tryOnRequestId) {
        clearInterval(timerInterval);
        console.log(`[NovaTryOnMe] Discarding stale try-on result (req#${thisRequestId}, current is req#${tryOnRequestId})`);
        return;
      }

      // Stop timer and compute elapsed
      clearInterval(timerInterval);
      const tryOnElapsed = ((Date.now() - tryOnStart) / 1000).toFixed(1);

      // Display the result (minimal overlay — controls are in the side panel)
      const resultDataUrl = base64ToDataUrl(resultImage);
      body.innerHTML = `
        <div class="nova-tryon-result">
          <img src="${resultDataUrl}" alt="Virtual try-on result" style="cursor:pointer;" title="Click to enlarge" />
        </div>
        <div class="nova-tryon-elapsed">Generated in ${tryOnElapsed}s</div>
        ${analysisResult && analysisResult.styleTips ? `
          <div class="nova-tryon-style-tips">
            <div class="nova-tryon-style-tips-title">Style Tips</div>
            ${analysisResult.styleTips}
          </div>
        ` : ""}
        <div style="text-align:center;">
          <button class="nova-tryon-favorite-btn" data-asin="${productData.asin || ''}">
            <span class="nova-tryon-favorite-icon">\u2661</span> Save to Favorites
          </button>
        </div>
        <button class="nova-tryon-animate-btn">
          &#9654; Animate
        </button>
      `;

      // Store debug images — fetch the actual pose used from backend
      if (debugInfo) {
        // Get the pose image the backend actually used (from S3 via poseIndex)
        let debugBodyPhoto = photos.bodyPhoto;
        try {
          const allPhotos = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
              type: "API_CALL", endpoint: "/api/profile/photos/all", method: "GET", data: {}
            }, (res) => {
              if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
              if (res && res.error) return reject(new Error(res.error));
              resolve(res?.data || res);
            });
          });
          if (allPhotos.generated && allPhotos.generated[currentPoseIdx]) {
            debugBodyPhoto = allPhotos.generated[currentPoseIdx];
          }
        } catch (_) {}
        storeDebugImages(debugBodyPhoto, productImageBase64, debugInfo);
      }

      // Favorites button handler
      const favBtn = body.querySelector(".nova-tryon-favorite-btn");
      if (favBtn) {
        favBtn.addEventListener("click", async () => {
          try {
            const authStatus = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ type: "GET_AUTH_STATUS" }, (res) => {
                if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                resolve(res && res.data ? res.data : { isAuthenticated: false });
              });
            });

            if (!authStatus.isAuthenticated) {
              alert("Please sign in to save favorites.");
              return;
            }

            console.log("[NovaTryOnMe] SAVE FAVORITE — asin:", productData.asin);
            console.log("[NovaTryOnMe]   productImage:", productData.imageUrl ? "YES (" + productData.imageUrl.substring(0, 60) + "...)" : "NO");
            console.log("[NovaTryOnMe]   tryOnResultImage:", resultImage ? "YES (length=" + resultImage.length + ", starts=" + resultImage.substring(0, 30) + "...)" : "NO/EMPTY");

            const favResult = await ApiClient.addFavorite({
              asin: productData.asin || "",
              productTitle: productData.title || "",
              productImage: productData.imageUrl || "",
              category: analysisResult ? analysisResult.category : "",
              garmentClass: analysisResult ? analysisResult.garmentClass : "",
              tryOnResultImage: resultImage,
            });
            console.log("[NovaTryOnMe]   Save result:", JSON.stringify(favResult).substring(0, 200));

            favBtn.innerHTML = '<span class="nova-tryon-favorite-icon">\u2665</span> Saved!';
            favBtn.classList.add("nova-tryon-favorite-btn--saved");
          } catch (err) {
            console.error("[NovaTryOnMe] Failed to save favorite:", err);
            alert("Failed to save favorite: " + err.message);
          }
        });
      }

      // Animate button handler (generate video)
      const animateBtn = body.querySelector(".nova-tryon-animate-btn");
      animateBtn.addEventListener("click", () =>
        handleAnimate(body, resultImage, animateBtn)
      );

      // Lightbox: click result image to enlarge
      const resultImg = body.querySelector(".nova-tryon-result img");
      if (resultImg) {
        resultImg.addEventListener("click", () => openTryOnLightbox(resultDataUrl));
      }

    } catch (err) {
      clearInterval(timerInterval);
      console.error("%c ✗ TRY-ON FAILED %c " + err.message, "background:#f44336;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px;", "color:#f44336;font-weight:bold;");
      body.innerHTML = `
        <div class="nova-tryon-error">
          <div class="nova-tryon-error-icon">&#9888;</div>
          <div class="nova-tryon-error-text">Something went wrong</div>
          <div class="nova-tryon-error-detail">${err.message}</div>
          <button class="nova-tryon-retry-btn">Try Again</button>
        </div>
      `;

      // Retry handler
      const retryBtn = body.querySelector(".nova-tryon-retry-btn");
      if (retryBtn) {
        retryBtn.addEventListener("click", () => {
          body.innerHTML = `
            <div class="nova-tryon-loading">
              <div class="nova-tryon-spinner"></div>
              <div class="nova-tryon-loading-text">Retrying...</div>
            </div>
          `;
          performTryOn(card, photos, isCosmetic);
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Variation/Color Change Detection — Polling Watchdog
  // ---------------------------------------------------------------------------
  let watchdogInterval = null;
  let watchdogBusy = false; // Prevents overlapping async work

  /**
   * Start a simple setInterval watchdog that:
   *  (a) Re-injects the button if Amazon destroyed it
   *  (b) Detects image URL changes and auto-triggers try-on when enabled
   *
   * This replaces MutationObserver which proved unreliable against Amazon's
   * aggressive Twister DOM rebuilds.
   */
  let lastPageUrl = null; // Track page URL for navigation detection

  function setupVariationObserver() {
    lastImageUrl = productData.imageUrl;
    lastPageUrl = location.href;

    watchdogInterval = setInterval(() => {
      // (c) Check for page URL change (SPA navigation to new product)
      const currentPageUrl = location.href;
      if (currentPageUrl !== lastPageUrl && !watchdogBusy) {
        console.log("[NovaTryOnMe] Watchdog: PAGE URL CHANGED");
        console.log("[NovaTryOnMe]   old URL:", lastPageUrl);
        console.log("[NovaTryOnMe]   new URL:", currentPageUrl);
        lastPageUrl = currentPageUrl;
        handlePageNavigation();
      }

      // (a) Ensure button is always present
      if (!document.querySelector(".nova-tryon-btn")) {
        console.log("[NovaTryOnMe] Watchdog: button missing, re-injecting...");
        injectTryOnButton(); // This already adds handleTryOnClick listener
        // Restore active state if toggle is ON
        if (tryOnEnabled) {
          const newBtn = document.querySelector(".nova-tryon-btn");
          if (newBtn) {
            newBtn.classList.add("nova-tryon-btn--active");
            newBtn.classList.remove("nova-tryon-btn--pulse");
            newBtn.innerHTML = '<span class="nova-tryon-btn-icon">&#10024;</span> Try On: ON';
            const tooltip = document.createElement("div");
            tooltip.className = "nova-tryon-tooltip";
            tooltip.textContent = "Click to disable auto try-on";
            newBtn.appendChild(tooltip);
            // NOTE: Do NOT add another click listener — injectTryOnButton already did
          }
        }
      }

      // (b) Check for image URL change
      const newUrl = scrapeCurrentImageUrl();
      if (newUrl && newUrl !== lastImageUrl && !watchdogBusy) {
        console.log("[NovaTryOnMe] Watchdog: IMAGE CHANGED");
        console.log("[NovaTryOnMe]   old URL:", lastImageUrl?.substring(0, 80) + "...");
        console.log("[NovaTryOnMe]   new URL:", newUrl.substring(0, 80) + "...");
        console.log("[NovaTryOnMe]   tryOnEnabled:", tryOnEnabled);
        console.log("[NovaTryOnMe]   panelOpen:", panelOpen);
        lastImageUrl = newUrl;
        productData.imageUrl = newUrl;

        if (tryOnEnabled) {
          handleVariationChange(newUrl);
        }
      }
    }, 500);

    console.log("[NovaTryOnMe] Watchdog polling active (500ms).");
  }

  /**
   * Handle a detected variation/color change when try-on is enabled.
   */
  async function handleVariationChange(newUrl) {
    console.log("[NovaTryOnMe] === VARIATION CHANGE HANDLER ===");
    console.log("[NovaTryOnMe]   newUrl:", newUrl.substring(0, 80) + "...");
    console.log("[NovaTryOnMe]   tryOnEnabled:", tryOnEnabled);
    console.log("[NovaTryOnMe]   panelOpen:", panelOpen);
    console.log("[NovaTryOnMe]   hasOverlayCard:", !!overlayCard);
    console.log("[NovaTryOnMe]   hasCurrentPhotos:", !!currentPhotos);
    watchdogBusy = true;

    // Re-fetch the new product image
    try {
      console.log("[NovaTryOnMe]   → Fetching new product image...");
      productImageBase64 = await fetchImageAsBase64(newUrl);
      console.log("[NovaTryOnMe]   → Fetched, base64 length:", productImageBase64.length);
    } catch (err) {
      console.error("[NovaTryOnMe] Failed to fetch new variation image:", err);
      watchdogBusy = false;
      return;
    }

    // Re-analyze the product
    try {
      console.log("[NovaTryOnMe]   → Re-analyzing product with Nova 2 Lite...");
      analysisResult = await ApiClient.analyzeProduct(
        productImageBase64,
        productData.title,
        productData.breadcrumbs
      );
      console.log("[NovaTryOnMe]   → Analysis result:", JSON.stringify(analysisResult));
    } catch (err) {
      console.warn("[NovaTryOnMe] Re-analysis failed:", err.message);
    }

    // Auto-refresh the try-on overlay
    console.log("[NovaTryOnMe]   → Checking overlay state: panelOpen=%s, overlayCard=%s, currentPhotos=%s", panelOpen, !!overlayCard, !!currentPhotos);
    if (panelOpen && overlayCard && currentPhotos) {
      const body = overlayCard.querySelector(".nova-tryon-overlay-body");
      if (body) {
        body.innerHTML = `
          <div class="nova-tryon-loading">
            <div class="nova-tryon-spinner"></div>
            <div class="nova-tryon-loading-text">Updating with new color...</div>
            <div class="nova-tryon-loading-subtext">This may take a few seconds</div>
            <div class="nova-tryon-loading-timer" id="tryOnElapsedTimer">0.0s</div>
          </div>
        `;
        performTryOn(overlayCard, currentPhotos, currentIsCosmetic);
      }
    } else if (!panelOpen && currentPhotos) {
      // Overlay was closed but toggle is still ON — re-open it
      openOverlay(currentPhotos, currentIsCosmetic);
    }

    watchdogBusy = false;
  }

  /**
   * Handle page navigation (SPA-style URL change on Amazon).
   * Re-scrapes product data and auto-triggers try-on if enabled.
   */
  async function handlePageNavigation() {
    watchdogBusy = true;
    console.log("[NovaTryOnMe] === PAGE NAVIGATION HANDLER ===");

    // Re-scrape the new product page
    const newProductData = scrapeProductData();
    if (!newProductData.imageUrl) {
      console.warn("[NovaTryOnMe] New page has no product image, skipping.");
      watchdogBusy = false;
      return;
    }

    productData = newProductData;
    lastImageUrl = productData.imageUrl;
    console.log("[NovaTryOnMe]   New product:", productData.title);

    // Re-fetch the product image
    try {
      productImageBase64 = await fetchImageAsBase64(productData.imageUrl);
    } catch (err) {
      console.error("[NovaTryOnMe] Failed to fetch new product image:", err);
      watchdogBusy = false;
      return;
    }

    // Re-analyze the product
    try {
      analysisResult = await ApiClient.analyzeProduct(
        productImageBase64,
        productData.title,
        productData.breadcrumbs
      );
      console.log("[NovaTryOnMe]   Analysis result:", JSON.stringify(analysisResult));
    } catch (err) {
      console.warn("[NovaTryOnMe] Product analysis failed:", err.message);
    }

    // Re-inject button if needed (new page may not have it)
    if (!document.querySelector(".nova-tryon-btn")) {
      injectTryOnButton();
    }

    // Auto-trigger try-on if enabled
    if (tryOnEnabled && currentPhotos) {
      const isCosmetic =
        analysisResult &&
        analysisResult.category &&
        analysisResult.category.toLowerCase().includes("cosmetic");
      currentIsCosmetic = isCosmetic;

      // Close existing overlay and open fresh one
      if (panelOpen && overlayCard) {
        overlayCard.remove();
        overlayCard = null;
        panelOpen = false;
      }
      openOverlay(currentPhotos, isCosmetic);
    }

    watchdogBusy = false;
  }

  // ---------------------------------------------------------------------------
  // Video Animation (Grok Imagine Video)
  // ---------------------------------------------------------------------------
  async function handleAnimate(body, resultImage, btn) {
    btn.disabled = true;
    btn.textContent = "Generating video... 0s";

    const videoStart = Date.now();
    const videoTimerInterval = setInterval(() => {
      const elapsed = ((Date.now() - videoStart) / 1000).toFixed(0);
      btn.textContent = `Generating video... ${elapsed}s`;
    }, 1000);

    try {
      const response = await ApiClient.generateVideo(resultImage);
      const jobId = response.jobId;
      const videoProvider = response.provider || "grok";

      // Poll for video completion
      const videoResult = await pollVideoStatus(jobId, videoProvider);

      clearInterval(videoTimerInterval);
      const videoElapsed = ((Date.now() - videoStart) / 1000).toFixed(1);

      // Display the video
      const videoContainer = document.createElement("div");
      videoContainer.className = "nova-tryon-video-container";
      const videoSrc = videoResult.videoBase64
        ? `data:${videoResult.videoMimeType || "video/mp4"};base64,${videoResult.videoBase64}`
        : videoResult.videoUrl;
      videoContainer.innerHTML = `
        <video class="nova-tryon-video" controls autoplay loop>
          <source src="${videoSrc}" type="video/mp4" />
          Your browser does not support the video tag.
        </video>
        <div class="nova-tryon-video-actions">
          <span class="nova-tryon-elapsed">Video generated in ${videoElapsed}s</span>
          <div class="nova-tryon-video-btns">
            <button class="nova-tryon-save-video-btn" title="Save to your account">Save</button>
            <button class="nova-tryon-download-video-btn" title="Download to your computer">Download</button>
          </div>
        </div>
      `;

      // Wire Save button (upload to S3)
      const saveBtn = videoContainer.querySelector(".nova-tryon-save-video-btn");
      saveBtn.addEventListener("click", async () => {
        saveBtn.textContent = "Saving...";
        saveBtn.disabled = true;
        try {
          const asin = productData?.asin || "";
          await ApiClient.saveVideo(
            videoResult.videoUrl || null,
            videoResult.videoBase64 || null,
            asin,
            productData?.title || "",
            productData?.imageUrl || ""
          );
          saveBtn.textContent = "Saved!";
        } catch (err) {
          console.error("[NovaTryOnMe] Failed to save video:", err);
          saveBtn.textContent = "Failed";
          setTimeout(() => { saveBtn.textContent = "Save"; saveBtn.disabled = false; }, 2000);
        }
      });

      // Wire Download button (local download via blob to avoid cross-origin navigation)
      const downloadBtn = videoContainer.querySelector(".nova-tryon-download-video-btn");
      downloadBtn.addEventListener("click", async () => {
        downloadBtn.textContent = "Downloading...";
        downloadBtn.disabled = true;
        try {
          const resp = await fetch(videoSrc);
          const blob = await resp.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = "tryon-video-" + Date.now() + ".mp4";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
          downloadBtn.textContent = "Download";
          downloadBtn.disabled = false;
        } catch (err) {
          console.error("[NovaTryOnMe] Download failed:", err);
          downloadBtn.textContent = "Failed";
          setTimeout(() => { downloadBtn.textContent = "Download"; downloadBtn.disabled = false; }, 2000);
        }
      });

      body.appendChild(videoContainer);
      btn.textContent = "\u25B6 Animate";
      btn.disabled = false;
    } catch (err) {
      clearInterval(videoTimerInterval);
      console.error("[NovaTryOnMe] Video generation failed:", err);
      btn.textContent = "\u25B6 Animate";
      btn.disabled = false;
      const errorDiv = document.createElement("div");
      errorDiv.className = "nova-tryon-error";
      errorDiv.textContent = `Video generation failed: ${err.message}`;
      body.appendChild(errorDiv);
    }
  }

  /**
   * Poll the backend for video generation status until complete or failed.
   * @param {string} jobId - The video generation job ID
   * @returns {Promise<string>} URL of the completed video
   */
  async function pollVideoStatus(jobId, provider) {
    const MAX_POLLS = 60;
    const POLL_INTERVAL = 5000; // 5 seconds

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));

      const status = await ApiClient.getVideoStatus(jobId, provider);

      if ((status.status === "Completed" || status.status === "COMPLETED") && (status.videoUrl || status.videoBase64)) {
        return status;
      }
      if (status.status === "Failed" || status.status === "FAILED") {
        throw new Error(status.failureMessage || status.error || "Video generation failed");
      }
      // Otherwise keep polling (IN_PROGRESS)
    }

    throw new Error("Video generation timed out");
  }

  // ---------------------------------------------------------------------------
  // Lightbox for try-on result image
  // ---------------------------------------------------------------------------
  function openTryOnLightbox(imageSrc) {
    // Remove existing lightbox if any
    const existing = document.getElementById("nova-tryon-lightbox");
    if (existing) existing.remove();

    const lightbox = document.createElement("div");
    lightbox.id = "nova-tryon-lightbox";
    lightbox.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:100000;display:flex;align-items:center;justify-content:center;";

    lightbox.innerHTML = `
      <div style="position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);" data-close="1"></div>
      <div style="position:relative;max-width:90%;max-height:90%;">
        <img src="${imageSrc}" style="max-width:100%;max-height:85vh;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.5);display:block;" alt="Try-on result full size" />
        <button style="position:absolute;top:-12px;right:-12px;width:32px;height:32px;border-radius:50%;border:none;background:#fff;color:#333;font-size:20px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);" data-close="1">&times;</button>
      </div>
    `;

    // Close on backdrop/button click
    lightbox.addEventListener("click", (e) => {
      if (e.target.dataset.close === "1" || e.target.closest("[data-close='1']")) {
        lightbox.remove();
      }
    });

    // Close on Escape
    const escHandler = (e) => {
      if (e.key === "Escape") {
        lightbox.remove();
        document.removeEventListener("keydown", escHandler);
      }
    };
    document.addEventListener("keydown", escHandler);

    document.body.appendChild(lightbox);
  }

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  init();
})();
