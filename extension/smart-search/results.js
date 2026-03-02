/**
 * NovaTryOnMe - Smart Search Results Page
 *
 * Receives search query via URL params, calls backend via background.js,
 * displays product grid, and enables virtual try-on for each product.
 *
 * Uses the same ApiClient class as the Focused Product Page (content.js)
 * to ensure identical pipeline behavior.
 *
 * NOTE: No inline event handlers (onclick) — Chrome extension CSP forbids them.
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let searchStartTime = 0;
let timerInterval = null;
let tryOnTimerInterval = null;
let tryOnStartTime = 0;
let currentPoseIndex = 0;
let currentFraming = 'full';

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
const params = new URLSearchParams(window.location.search);
const rawQuery = params.get("q") || "";
const clothesSize = params.get("clothesSize") || "";
const shoesSize = params.get("shoesSize") || "";
const userSex = params.get("sex") || "";

// Build enriched query with user's size preferences
let query = rawQuery;
if (query) {
  const sizeParts = [];
  // Add sex-appropriate suffix if not already in query
  if (userSex && !query.toLowerCase().includes("for men") && !query.toLowerCase().includes("for women")) {
    sizeParts.push(userSex === "male" ? "for men" : "for women");
  }
  // Add clothes size for apparel queries (skip if query is clearly about shoes only)
  const isShoeQuery = /\bshoes?\b|\bsneakers?\b|\bboots?\b|\bsandals?\b|\bheels?\b/i.test(query);
  if (clothesSize && !isShoeQuery) {
    sizeParts.push(`size ${clothesSize}`);
  }
  if (shoesSize && isShoeQuery) {
    sizeParts.push(`size ${shoesSize}`);
  }
  if (sizeParts.length) {
    query = `${rawQuery} ${sizeParts.join(" ")}`;
  }
}

document.getElementById("searchQuery").textContent = rawQuery
  ? `Results for: "${rawQuery}"`
  : "Smart Search";

// Wire up non-inline event listeners
document.getElementById("errorCloseBtn").addEventListener("click", () => window.close());
document.getElementById("modalCloseBtn").addEventListener("click", closeTryOnModal);
document.getElementById("tryOnModal").addEventListener("click", (e) => {
  if (
    e.target.id === "tryOnModal" ||
    e.target.classList.contains("nova-modal-close") ||
    e.target.closest(".nova-modal-close")
  ) {
    closeTryOnModal();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeTryOnModal();
});

// Load pose/framing from storage (same as content.js)
chrome.storage.local.get(["selectedPoseIndex", "tryOnFraming"], (stored) => {
  if (stored.selectedPoseIndex !== undefined) currentPoseIndex = stored.selectedPoseIndex;
  if (stored.tryOnFraming) currentFraming = stored.tryOnFraming;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.selectedPoseIndex) currentPoseIndex = changes.selectedPoseIndex.newValue || 0;
  if (changes.tryOnFraming) currentFraming = changes.tryOnFraming.newValue || "full";
});

if (query) {
  startSearch(query);
} else {
  showError("No search query provided.");
}

// ---------------------------------------------------------------------------
// Search Timer
// ---------------------------------------------------------------------------
function startTimer() {
  searchStartTime = Date.now();
  const timerEl = document.getElementById("searchTimer");
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - searchStartTime) / 1000);
    timerEl.textContent = `Elapsed: ${elapsed}s`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  return Math.floor((Date.now() - searchStartTime) / 1000);
}

// ---------------------------------------------------------------------------
// Search (uses ApiClient._sendMessage for SMART_SEARCH which has no wrapper)
// ---------------------------------------------------------------------------
async function startSearch(q) {
  showLoading();
  startTimer();
  try {
    const result = await ApiClient._sendMessage({
      type: "SMART_SEARCH",
      query: q,
    });

    const elapsedSeconds = stopTimer();

    if (!result || result.error) {
      showError(result?.error || "Search failed. Please try again.");
      return;
    }

    const products = result.products || [];
    if (products.length === 0) {
      showError("No products found. Try a different search query.");
      return;
    }

    renderResults(products, elapsedSeconds);
  } catch (err) {
    stopTimer();
    console.error("[SmartSearch] Error:", err);
    showError(err.message || "An unexpected error occurred.");
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function showLoading() {
  document.getElementById("loadingState").hidden = false;
  document.getElementById("errorState").hidden = true;
  document.getElementById("resultsGrid").hidden = true;
}

function showError(message) {
  document.getElementById("loadingState").hidden = true;
  document.getElementById("errorState").hidden = false;
  document.getElementById("resultsGrid").hidden = true;
  document.getElementById("errorMessage").textContent = message;
}

function renderResults(products, elapsedSeconds) {
  document.getElementById("loadingState").hidden = true;
  document.getElementById("errorState").hidden = true;
  document.getElementById("resultsGrid").hidden = false;

  document.getElementById("resultCount").textContent =
    `${products.length} product${products.length !== 1 ? "s" : ""} found`;

  if (elapsedSeconds !== undefined) {
    const timeEl = document.getElementById("searchTime");
    const mins = Math.floor(elapsedSeconds / 60);
    const secs = elapsedSeconds % 60;
    const timeStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    timeEl.textContent = `Found in ${timeStr}`;
  }

  const grid = document.getElementById("productGrid");
  grid.innerHTML = "";

  products.forEach((product, index) => {
    grid.appendChild(createProductCard(product, index));
  });
}

function createProductCard(product, index) {
  const card = document.createElement("div");
  card.className = "nova-card";
  card.dataset.product = JSON.stringify(product);

  const img = document.createElement("img");
  img.className = "nova-card-image";
  img.src = product.image_url;
  img.alt = product.title;
  img.addEventListener("error", function () {
    this.src =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect fill="#f0f0f0" width="200" height="200"/><text x="50%" y="50%" text-anchor="middle" dy=".3em" fill="#999" font-size="14">No Image</text></svg>'
      );
  });
  card.appendChild(img);

  const body = document.createElement("div");
  body.className = "nova-card-body";

  const titleDiv = document.createElement("div");
  titleDiv.className = "nova-card-title";
  const titleLink = document.createElement("a");
  titleLink.href = product.product_url;
  titleLink.target = "_blank";
  titleLink.rel = "noopener";
  titleLink.textContent = product.title;
  titleDiv.appendChild(titleLink);
  body.appendChild(titleDiv);

  if (product.rating) {
    const ratingDiv = document.createElement("div");
    ratingDiv.className = "nova-card-rating";
    const starsSpan = document.createElement("span");
    starsSpan.className = "nova-card-stars";
    starsSpan.textContent = renderStars(product.rating);
    ratingDiv.appendChild(starsSpan);
    const ratingText = document.createElement("span");
    ratingText.textContent = product.rating;
    ratingDiv.appendChild(ratingText);
    body.appendChild(ratingDiv);
  }

  if (product.review_count) {
    const popDiv = document.createElement("div");
    popDiv.className = "nova-card-popularity";
    popDiv.textContent = product.review_count + " in past month";
    body.appendChild(popDiv);
  }

  if (product.price) {
    const priceDiv = document.createElement("div");
    priceDiv.className = "nova-card-price";
    priceDiv.textContent = product.price;
    body.appendChild(priceDiv);
  }

  const actionsDiv = document.createElement("div");
  actionsDiv.className = "nova-card-actions";

  const tryOnBtn = document.createElement("button");
  tryOnBtn.className = "nova-btn nova-btn-primary";
  tryOnBtn.dataset.index = index;
  tryOnBtn.innerHTML = "&#10024; Try On";
  tryOnBtn.addEventListener("click", () => handleTryOn(index));
  actionsDiv.appendChild(tryOnBtn);

  const buyLink = document.createElement("a");
  buyLink.className = "nova-btn nova-btn-secondary";
  buyLink.href = product.product_url;
  buyLink.target = "_blank";
  buyLink.rel = "noopener";
  buyLink.textContent = "Buy";
  actionsDiv.appendChild(buyLink);

  body.appendChild(actionsDiv);
  card.appendChild(body);
  return card;
}

function renderStars(rating) {
  const num = parseFloat(rating) || 0;
  const full = Math.floor(num);
  const half = num - full >= 0.3 ? 1 : 0;
  const empty = 5 - full - half;
  return "\u2605".repeat(full) + (half ? "\u00BD" : "") + "\u2606".repeat(empty);
}

// ---------------------------------------------------------------------------
// Try-On — mirrors content.js performTryOn() using identical ApiClient calls
// ---------------------------------------------------------------------------

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), ms)
    ),
  ]);
}

function startTryOnTimer() {
  tryOnStartTime = Date.now();
  const timerEl = document.getElementById("tryOnTimer");
  if (timerEl) timerEl.textContent = "0s";
  tryOnTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - tryOnStartTime) / 1000);
    if (timerEl) timerEl.textContent = `${elapsed}s`;
  }, 1000);
}

function stopTryOnTimer() {
  if (tryOnTimerInterval) {
    clearInterval(tryOnTimerInterval);
    tryOnTimerInterval = null;
  }
}

function updateTryOnStatus(step, message) {
  console.log(
    `%c STEP ${step} %c ${message}`,
    "background:#FF9900;color:#000;font-weight:bold;padding:2px 6px;border-radius:3px;",
    "color:#FF9900;font-weight:bold;"
  );
  const statusEl = document.getElementById("tryOnStatus");
  if (statusEl) statusEl.textContent = message;
}

// Same logDebugSteps as content.js
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

// Same storeDebugImages as content.js
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

async function handleTryOn(index) {
  const card = document.querySelectorAll(".nova-card")[index];
  if (!card) return;

  const product = JSON.parse(card.dataset.product);
  const btn = card.querySelector(".nova-btn-primary");

  if (btn) {
    btn.disabled = true;
    btn.textContent = "\u23F3 Processing...";
  }

  try {
    // Step 1: Get user's body photo — same as content.js
    updateTryOnStatus(1, "Loading your photo...");
    const photos = await withTimeout(
      ApiClient._sendMessage({ type: "GET_USER_PHOTOS" }),
      5000
    );

    if (!photos || !photos.bodyPhoto) {
      alert(
        "Please upload your body photo first!\n\nOpen the SuperNova TryOnMe extension panel and complete your profile setup."
      );
      return;
    }

    showTryOnModal();
    startTryOnTimer();

    // Step 2: Fetch product image as base64 — same as content.js fetchImageAsBase64
    updateTryOnStatus(2, "Fetching product image...");
    const garmentBase64 = await withTimeout(
      ApiClient._sendMessage({ type: "PROXY_IMAGE", url: product.image_url }),
      15000
    );

    if (!garmentBase64) {
      throw new Error("Failed to fetch product image");
    }

    // Step 3: Analyze product — same as content.js ApiClient.analyzeProduct()
    updateTryOnStatus(3, "Analyzing product...");
    let analysisResult = null;
    try {
      analysisResult = await withTimeout(
        ApiClient.analyzeProduct(garmentBase64, product.title || "", ""),
        15000
      );
      console.log("[SmartSearch] Product analysis:", JSON.stringify(analysisResult));
    } catch (err) {
      console.warn("[SmartSearch] Product analysis failed, proceeding without garmentClass:", err.message);
    }

    // Step 4: Call try-on pipeline — identical to content.js ApiClient.tryOn()
    updateTryOnStatus(4, "AI pipeline running (5 steps)...");
    console.log(`[SmartSearch] Try-on params — poseIdx: ${currentPoseIndex}, framing: ${currentFraming}, garmentClass: ${analysisResult ? analysisResult.garmentClass : 'null'}`);

    const response = await withTimeout(
      ApiClient.tryOn(
        null,                                              // bodyImage = null → backend fetches from S3
        garmentBase64,                                     // garment image
        analysisResult ? analysisResult.garmentClass : null, // garmentClass from analysis
        "SEAMLESS",                                        // mergeStyle
        currentFraming,                                    // framing from side panel
        currentPoseIndex                                   // poseIndex from side panel
      ),
      180000
    );

    const resultImage = response.resultImage;
    const debugInfo = response.debug;

    // Log all backend pipeline steps — same as content.js
    logDebugSteps(debugInfo);

    stopTryOnTimer();

    if (resultImage) {
      // Store debug images for side panel — same as content.js
      if (debugInfo) {
        let debugBodyPhoto = photos.bodyPhoto;
        try {
          const allPhotos = await ApiClient._sendMessage({
            type: "API_CALL", endpoint: "/api/profile/photos/all", method: "GET", data: {}
          });
          if (allPhotos.generated && allPhotos.generated[currentPoseIndex]) {
            debugBodyPhoto = allPhotos.generated[currentPoseIndex];
          }
        } catch (_) {}
        storeDebugImages(debugBodyPhoto, garmentBase64, debugInfo);
      }
      showTryOnResult(resultImage, product);
    } else {
      throw new Error(response?.error || "Try-on failed — no result image returned");
    }
  } catch (err) {
    stopTryOnTimer();
    console.error(`%c ✗ TRY-ON FAILED %c ${err.message}`, "background:#f44336;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px;", "color:#f44336;font-weight:bold;");
    closeTryOnModal();
    alert("Try-on failed: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = "&#10024; Try On";
    }
  }
}

// ---------------------------------------------------------------------------
// Try-On Modal
// ---------------------------------------------------------------------------
function showTryOnModal() {
  const modal = document.getElementById("tryOnModal");
  const body = document.getElementById("tryOnModalBody");
  modal.hidden = false;
  body.innerHTML = "";

  const loadingDiv = document.createElement("div");
  loadingDiv.className = "nova-loading";

  const spinner = document.createElement("div");
  spinner.className = "nova-loading-spinner";
  loadingDiv.appendChild(spinner);

  const msg = document.createElement("p");
  msg.id = "tryOnStatus";
  msg.textContent = "Preparing virtual try-on...";
  loadingDiv.appendChild(msg);

  const hint = document.createElement("p");
  hint.className = "nova-loading-hint";
  hint.textContent = "This may take 15-30 seconds";
  loadingDiv.appendChild(hint);

  const timer = document.createElement("p");
  timer.className = "nova-loading-timer";
  timer.id = "tryOnTimer";
  timer.textContent = "0s";
  loadingDiv.appendChild(timer);

  body.appendChild(loadingDiv);
}

function showTryOnResult(base64Image, product) {
  const body = document.getElementById("tryOnModalBody");
  body.innerHTML = "";
  const title = product.title || "";

  // Result image
  const img = document.createElement("img");
  img.src = "data:image/png;base64," + base64Image;
  img.alt = "Try-on result for " + title;
  body.appendChild(img);

  // Caption
  const caption = document.createElement("p");
  caption.style.cssText = "text-align:center; margin-top:12px; font-size:13px; color:#565959;";
  caption.textContent = title;
  body.appendChild(caption);

  // Save to Favorites — same as content.js ApiClient.addFavorite()
  const favDiv = document.createElement("div");
  favDiv.style.cssText = "text-align:center; margin-top:10px;";
  const favBtn = document.createElement("button");
  favBtn.className = "nova-btn-favorite";
  favBtn.innerHTML = "&#9825; Save to Favorites";
  favBtn.addEventListener("click", async () => {
    try {
      // Extract ASIN from product_url (e.g. https://www.amazon.com/dp/B0123ABC)
      const asinMatch = (product.product_url || "").match(/\/dp\/([A-Z0-9]{10})/);
      const asin = asinMatch ? asinMatch[1] : product.asin || "";

      await ApiClient.addFavorite({
        asin,
        productTitle: product.title || "",
        productImage: product.image_url || "",
        category: "",
        garmentClass: "",
        tryOnResultImage: base64Image,
      });
      favBtn.innerHTML = "&#9829; Saved!";
      favBtn.classList.add("nova-btn-favorite--saved");
      favBtn.disabled = true;
    } catch (err) {
      console.error("[SmartSearch] Failed to save favorite:", err);
      alert("Failed to save: " + err.message);
    }
  });
  favDiv.appendChild(favBtn);
  body.appendChild(favDiv);
}

function closeTryOnModal() {
  stopTryOnTimer();
  document.getElementById("tryOnModal").hidden = true;
}
