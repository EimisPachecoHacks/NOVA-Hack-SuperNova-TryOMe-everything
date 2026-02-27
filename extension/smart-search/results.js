/**
 * NovaTryOnMe - Smart Search Results Page
 *
 * Receives search query via URL params, calls backend via background.js,
 * displays product grid, and enables virtual try-on for each product.
 *
 * NOTE: No inline event handlers (onclick) — Chrome extension CSP forbids them.
 */

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

let searchStartTime = 0;
let timerInterval = null;

const params = new URLSearchParams(window.location.search);
const query = params.get("q") || "";

document.getElementById("searchQuery").textContent = query
  ? `Results for: "${query}"`
  : "Smart Search";

// Wire up non-inline event listeners
document.getElementById("errorCloseBtn").addEventListener("click", () => window.close());
document.getElementById("modalCloseBtn").addEventListener("click", closeTryOnModal);
// Close modal when clicking overlay background or any close button inside
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
// Search
// ---------------------------------------------------------------------------

async function startSearch(q) {
  showLoading();
  startTimer();
  try {
    const result = await sendMessage({
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

  // Show search duration
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
    const card = createProductCard(product, index);
    grid.appendChild(card);
  });
}

function createProductCard(product, index) {
  const card = document.createElement("div");
  card.className = "nova-card";
  card.dataset.product = JSON.stringify(product);

  // Image
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

  // Body
  const body = document.createElement("div");
  body.className = "nova-card-body";

  // Title
  const titleDiv = document.createElement("div");
  titleDiv.className = "nova-card-title";
  const titleLink = document.createElement("a");
  titleLink.href = product.product_url;
  titleLink.target = "_blank";
  titleLink.rel = "noopener";
  titleLink.textContent = product.title;
  titleDiv.appendChild(titleLink);
  body.appendChild(titleDiv);

  // Rating (if available)
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

  // Popularity (if available)
  if (product.review_count) {
    const popDiv = document.createElement("div");
    popDiv.className = "nova-card-popularity";
    popDiv.textContent = product.review_count + " in past month";
    body.appendChild(popDiv);
  }

  // Price (if available)
  if (product.price) {
    const priceDiv = document.createElement("div");
    priceDiv.className = "nova-card-price";
    priceDiv.textContent = product.price;
    body.appendChild(priceDiv);
  }

  // Actions
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
// Try-On
// ---------------------------------------------------------------------------

let tryOnTimerInterval = null;
let tryOnStartTime = 0;

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
    // Step 1: Get user's body photo
    updateTryOnStatus(1, "Loading your photo...");
    const photos = await withTimeout(
      sendMessage({ type: "GET_USER_PHOTOS" }),
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

    // Step 2: Fetch product image as base64
    updateTryOnStatus(2, "Fetching product image...");
    const garmentBase64 = await withTimeout(
      sendMessage({ type: "PROXY_IMAGE", url: product.image_url }),
      15000
    );

    if (!garmentBase64) {
      throw new Error("Failed to fetch product image");
    }

    // Step 3: Call unified try-on pipeline (backend does all 5 steps)
    updateTryOnStatus(3, "AI pipeline running (5 steps)...");
    const result = await withTimeout(
      sendMessage({
        type: "TRY_ON",
        bodyImageBase64: photos.bodyPhoto,
        garmentImageBase64: garmentBase64,
        mergeStyle: "SEAMLESS",
      }),
      180000
    );

    // Log all backend pipeline steps to console
    if (result && result.debug) {
      logDebugSteps(result.debug);
    }

    stopTryOnTimer();

    if (result && result.resultImage) {
      showTryOnResult(result.resultImage, product.title, photos.bodyPhoto, garmentBase64, result.debug);
    } else {
      throw new Error(result?.error || "Try-on failed — no result image returned");
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

function showTryOnResult(base64Image, title, bodyPhotoBase64, garmentBase64, debug) {
  const body = document.getElementById("tryOnModalBody");
  body.innerHTML = "";

  // Debug panel: show images sent to Gemini
  if (bodyPhotoBase64 && garmentBase64) {
    const debugPanel = document.createElement("div");
    debugPanel.className = "nova-tryon-debug-panel";

    const debugTitle = document.createElement("div");
    debugTitle.className = "nova-tryon-debug-title";
    debugTitle.textContent = "Images sent to Gemini 2.5 Flash";
    debugPanel.appendChild(debugTitle);

    const imagesRow = document.createElement("div");
    imagesRow.className = "nova-tryon-debug-images";

    // User photo
    const userWrap = document.createElement("div");
    userWrap.className = "nova-tryon-debug-img-wrap";
    const userImg = document.createElement("img");
    userImg.src = bodyPhotoBase64.startsWith("data:") ? bodyPhotoBase64 : "data:image/jpeg;base64," + bodyPhotoBase64;
    userImg.alt = "Your body";
    userWrap.appendChild(userImg);
    const userLabel = document.createElement("span");
    userLabel.textContent = "Your Photo";
    userWrap.appendChild(userLabel);
    imagesRow.appendChild(userWrap);

    // Arrow
    const arrow1 = document.createElement("div");
    arrow1.className = "nova-tryon-debug-arrow";
    arrow1.textContent = "+";
    imagesRow.appendChild(arrow1);

    // Garment
    const garmentWrap = document.createElement("div");
    garmentWrap.className = "nova-tryon-debug-img-wrap";
    const garmentImg = document.createElement("img");
    garmentImg.src = garmentBase64.startsWith("data:") ? garmentBase64 : "data:image/jpeg;base64," + garmentBase64;
    garmentImg.alt = "Garment";
    garmentWrap.appendChild(garmentImg);
    const garmentLabel = document.createElement("span");
    const extracted = debug && debug.garmentImageUsed === "extracted";
    garmentLabel.textContent = extracted ? "Garment (extracted)" : "Garment (original)";
    garmentWrap.appendChild(garmentLabel);
    imagesRow.appendChild(garmentWrap);

    // Arrow
    const arrow2 = document.createElement("div");
    arrow2.className = "nova-tryon-debug-arrow";
    arrow2.textContent = "=";
    imagesRow.appendChild(arrow2);

    debugPanel.appendChild(imagesRow);
    body.appendChild(debugPanel);
  }

  const img = document.createElement("img");
  img.src = "data:image/png;base64," + base64Image;
  img.alt = "Try-on result for " + title;
  body.appendChild(img);

  const caption = document.createElement("p");
  caption.style.cssText = "text-align:center; margin-top:12px; font-size:13px; color:#565959;";
  caption.textContent = title;
  body.appendChild(caption);
}

function closeTryOnModal() {
  stopTryOnTimer();
  document.getElementById("tryOnModal").hidden = true;
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (response && response.error) {
        return reject(new Error(response.error));
      }
      resolve(response?.data || response);
    });
  });
}
