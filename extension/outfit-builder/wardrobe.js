/**
 * NovaTryOnMe — Virtual Wardrobe (Outfit Builder)
 *
 * Opens from popup Outfit Builder tab. Fires up to 3 parallel smart-searches,
 * populates wardrobe walls with hangers, enables item selection + try-on.
 *
 * NOTE: No inline event handlers — Chrome extension CSP forbids them.
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let selectedTop = null;
let selectedBottom = null;
let selectedShoes = null;
let selectedItem = null; // last selected item (for try-on target)
let userPosePhoto = null;
let selectedPoseIndex = 0;
let searchStartTime = 0;
let timerInterval = null;
let tryOnTimerInterval = null;
let lastTryOnResultBase64 = null;

// ---------------------------------------------------------------------------
// Init — parse URL params, wire events, start searches
// ---------------------------------------------------------------------------
const params = new URLSearchParams(window.location.search);
const topQuery = params.get("top") || "";
const bottomQuery = params.get("bottom") || "";
const shoesQuery = params.get("shoes") || "";
const clothesSizeParam = params.get("clothesSize") || "";
const shoesSizeParam = params.get("shoesSize") || "";
const userSexParam = params.get("sex") || "";
const sexSuffix = userSexParam === "male" ? "for men" : "for women";

// Wire event listeners (NO inline handlers)
document.getElementById("tryOnBtn").addEventListener("click", handleTryOn);
document.getElementById("favoriteBtn").addEventListener("click", handleSaveFavorite);
document.getElementById("errorCloseBtn").addEventListener("click", () => window.close());

// Clean up large base64 data on page unload
window.addEventListener("unload", () => {
  lastTryOnResultBase64 = null;
  userPosePhoto = null;
  selectedTop = null;
  selectedBottom = null;
  selectedShoes = null;
  selectedItem = null;
  if (timerInterval) clearInterval(timerInterval);
  if (tryOnTimerInterval) clearInterval(tryOnTimerInterval);
});

// Start
initWardrobe();

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------
async function initWardrobe() {
  startTimer();

  const promises = [];

  if (topQuery) {
    const topSizeStr = clothesSizeParam ? ` size ${clothesSizeParam}` : "";
    promises.push(searchCategory("top", `${topQuery} ${sexSuffix}${topSizeStr}`));
  } else {
    updateCategoryStatus("top", "Skipped");
  }

  if (bottomQuery) {
    const bottomSizeStr = clothesSizeParam ? ` size ${clothesSizeParam}` : "";
    promises.push(searchCategory("bottom", `${bottomQuery} ${sexSuffix}${bottomSizeStr}`));
  } else {
    updateCategoryStatus("bottom", "Skipped");
  }

  if (shoesQuery) {
    const shoesSizeStr = shoesSizeParam ? ` size ${shoesSizeParam}` : "";
    promises.push(searchCategory("shoes", `${shoesQuery} ${sexSuffix}${shoesSizeStr}`));
  } else {
    updateCategoryStatus("shoes", "Skipped");
  }

  // Fetch user photo in parallel
  promises.push(loadUserPhoto());

  await Promise.allSettled(promises);

  stopTimer();
  showWardrobe();
}

async function searchCategory(category, query) {
  updateCategoryStatus(category, "Searching...");

  try {
    const result = await sendMessage({
      type: "SMART_SEARCH",
      query: query,
    });

    if (!result || result.error) {
      updateCategoryStatus(category, "Failed");
      console.error(`[Wardrobe] ${category} search failed:`, result?.error);
      return;
    }

    const products = result.products || [];
    updateCategoryStatus(category, products.length + " found, removing backgrounds...");
    console.log(`[Wardrobe] ${category}: ${products.length} products found`);

    // Tag each product with its category
    products.forEach((p) => {
      p._category = category;
    });

    // Remove backgrounds from product images using Nova Canvas
    // Process in batches of 3 to avoid API rate limiting
    const maxItems = category === "shoes" ? 7 : 20;
    const items = products.slice(0, maxItems);
    const BATCH_SIZE = 3;
    let bgSuccessCount = 0;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map(async (product) => {
        try {
          // Fetch the product image as base64
          const imageBase64 = await sendMessage({
            type: "PROXY_IMAGE",
            url: product.image_url,
          });
          if (!imageBase64) return;

          // Resize to fit Nova Canvas requirements [320, 4096] pixels
          const resizedBase64 = await resizeImageBase64(imageBase64);

          // Remove background via Nova Canvas
          const noBgResult = await sendMessage({
            type: "REMOVE_BG",
            imageBase64: resizedBase64,
          });
          if (noBgResult && noBgResult.resultImage) {
            // Store the no-bg image as a data URL for display
            product._noBgImage = "data:image/png;base64," + noBgResult.resultImage;
            bgSuccessCount++;
          } else {
            console.warn(`[Wardrobe] BG removal returned no result for "${product.title?.substring(0, 30)}"`);
          }
        } catch (err) {
          console.warn(`[Wardrobe] BG removal failed for "${product.title?.substring(0, 30)}":`, err.message);
          // Falls back to original image_url
        }
      }));
      updateCategoryStatus(category, `${bgSuccessCount}/${items.length} backgrounds removed...`);
    }
    console.log(`[Wardrobe] ${category}: ${bgSuccessCount}/${items.length} backgrounds successfully removed`);

    updateCategoryStatus(category, products.length + " ready");
    renderCategory(category, products);
  } catch (err) {
    console.error(`[Wardrobe] ${category} search error:`, err);
    updateCategoryStatus(category, "Error");
  }
}

async function loadUserPhoto() {
  try {
    const photos = await sendMessage({ type: "GET_USER_PHOTOS" });
    if (photos && photos.bodyPhoto) {
      userPosePhoto = photos.bodyPhoto;
      selectedPoseIndex = photos.selectedPoseIndex || 0;
      showUserPhoto(userPosePhoto);
      console.log("[Wardrobe] User photo loaded, poseIndex:", selectedPoseIndex);
    }
  } catch (err) {
    console.warn("[Wardrobe] Failed to load user photo:", err);
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function renderCategory(category, products) {
  let containerId, maxItems;
  if (category === "top") {
    containerId = "topsContainer";
    maxItems = 20;
  } else if (category === "bottom") {
    containerId = "bottomsContainer";
    maxItems = 20;
  } else {
    containerId = "shoesContainer";
    maxItems = 7;
  }

  const container = document.getElementById(containerId);
  container.innerHTML = "";

  const items = products.slice(0, maxItems);

  items.forEach((product) => {
    if (category === "shoes") {
      container.appendChild(createShoeItem(product));
    } else {
      container.appendChild(createHangerItem(product));
    }
  });
}

function createHangerItem(product) {
  const wrapper = document.createElement("div");
  wrapper.className = "hanger-item";
  wrapper.addEventListener("click", () => selectItem(product, wrapper));

  // Hanger
  const hanger = document.createElement("div");
  hanger.className = "hanger";

  const hook = document.createElement("div");
  hook.className = "hanger-hook";
  hanger.appendChild(hook);

  const body = document.createElement("div");
  body.className = "hanger-body";
  hanger.appendChild(body);

  wrapper.appendChild(hanger);

  // Clothing item card
  const card = document.createElement("div");
  card.className = "clothing-item";

  const img = document.createElement("img");
  img.src = product._noBgImage || product.image_url || "";
  img.alt = product.title || "";
  img.loading = "lazy";
  img.addEventListener("error", function () {
    // Fallback to original URL if no-bg image fails
    if (product._noBgImage && this.src === product._noBgImage) {
      this.src = product.image_url || "";
    } else {
      this.style.display = "none";
    }
  });
  card.appendChild(img);

  // Title overlay
  const title = document.createElement("div");
  title.className = "clothing-title";
  title.textContent = product.title
    ? product.title.split(" ").slice(0, 4).join(" ")
    : "Item";
  card.appendChild(title);

  // Price badge
  if (product.price) {
    const price = document.createElement("div");
    price.className = "clothing-price";
    price.textContent = product.price;
    card.appendChild(price);
  }

  wrapper.appendChild(card);
  return wrapper;
}

function createShoeItem(product) {
  const wrapper = document.createElement("div");
  wrapper.className = "shoe-display";
  wrapper.addEventListener("click", () => selectItem(product, wrapper));

  const item = document.createElement("div");
  item.className = "shoe-item";

  const img = document.createElement("img");
  img.src = product._noBgImage || product.image_url || "";
  img.alt = product.title || "";
  img.loading = "lazy";
  img.addEventListener("error", function () {
    if (product._noBgImage && this.src === product._noBgImage) {
      this.src = product.image_url || "";
    } else {
      this.style.display = "none";
    }
  });
  item.appendChild(img);

  wrapper.appendChild(item);

  const title = document.createElement("div");
  title.className = "shoe-title";
  title.textContent = product.title
    ? product.title.split(" ").slice(0, 3).join(" ")
    : "Shoes";
  wrapper.appendChild(title);

  return wrapper;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------
function selectItem(product, element) {
  const category = product._category;

  // Remove previous selection in SAME category only
  const containerMap = { top: "topsContainer", bottom: "bottomsContainer", shoes: "shoesContainer" };
  const container = document.getElementById(containerMap[category]);
  if (container) {
    container.querySelectorAll(".hanger-item.selected, .shoe-display.selected")
      .forEach((el) => el.classList.remove("selected"));
  }

  // Highlight new selection
  element.classList.add("selected");

  // Store per-category selection
  if (category === "top") selectedTop = product;
  else if (category === "bottom") selectedBottom = product;
  else if (category === "shoes") selectedShoes = product;

  selectedItem = product;

  // Update info bar
  document.getElementById("selectedInfo").hidden = false;
  const parts = [];
  if (selectedTop) parts.push("Top: " + (selectedTop.title || "Item").split(" ").slice(0, 3).join(" "));
  if (selectedBottom) parts.push("Bottom: " + (selectedBottom.title || "Item").split(" ").slice(0, 3).join(" "));
  if (selectedShoes) parts.push("Shoes: " + (selectedShoes.title || "Item").split(" ").slice(0, 3).join(" "));
  document.getElementById("selectedName").textContent = parts.join(" | ");
  document.getElementById("selectedPrice").textContent = product.price || "";

  // Check if Try On should be enabled:
  // Must have both top AND bottom selected, plus shoes if shoes category is present
  const needShoes = !!shoesQuery;
  const canTryOn = selectedTop && selectedBottom && (!needShoes || selectedShoes);
  document.getElementById("tryOnBtn").disabled = !canTryOn;

  // Show buy link for last selected
  if (product.product_url) {
    const buyBtn = document.getElementById("buyBtn");
    buyBtn.href = product.product_url;
    buyBtn.hidden = false;
  }

  // Activate spotlights
  document.getElementById("spotlightTop").classList.add("active");
  document.getElementById("spotlightBottom").classList.add("active");

  // Reset mirror to user photo if a previous try-on result was showing
  if (userPosePhoto) {
    showUserPhoto(userPosePhoto);
  }

  // Hide favorite button when new selection changes
  document.getElementById("favoriteBtn").hidden = true;
  lastTryOnResultBase64 = null;

  console.log("[Wardrobe] Selected:", product.title, "category:", category,
    "| top:", !!selectedTop, "bottom:", !!selectedBottom, "shoes:", !!selectedShoes, "canTryOn:", canTryOn);
}

// ---------------------------------------------------------------------------
// Mirror
// ---------------------------------------------------------------------------
function showUserPhoto(base64) {
  const img = document.getElementById("mirrorPhoto");
  img.src = base64.startsWith("data:")
    ? base64
    : "data:image/jpeg;base64," + base64;
  img.hidden = false;
  document.getElementById("mirrorPlaceholder").hidden = true;
  document.getElementById("mirrorResult").hidden = true;
}

function showTryOnResult(base64) {
  const img = document.getElementById("mirrorResult");
  img.src = base64.startsWith("data:")
    ? base64
    : "data:image/png;base64," + base64;
  img.hidden = false;
  document.getElementById("mirrorPhoto").hidden = true;
  document.getElementById("mirrorPlaceholder").hidden = true;
}

// ---------------------------------------------------------------------------
// Try-On
// ---------------------------------------------------------------------------
async function handleTryOn() {
  if (!selectedTop || !selectedBottom) return;

  const btn = document.getElementById("tryOnBtn");
  btn.disabled = true;
  btn.textContent = "Processing...";

  showTryOnLoading();
  startTryOnTimer();

  try {
    // Ensure we have user photo
    if (!userPosePhoto) {
      updateTryOnStatus("Loading your photo...");
      const photos = await sendMessage({ type: "GET_USER_PHOTOS" });
      if (!photos || !photos.bodyPhoto) {
        throw new Error("Please upload your body photo first in the extension panel.");
      }
      userPosePhoto = photos.bodyPhoto;
      selectedPoseIndex = photos.selectedPoseIndex || 0;
    }

    // Build the list of garments to try on
    const garmentItems = [];
    if (selectedTop) garmentItems.push({ item: selectedTop, garmentClass: "UPPER_BODY", label: "upper wear" });
    if (selectedBottom) garmentItems.push({ item: selectedBottom, garmentClass: "LOWER_BODY", label: "lower wear" });
    if (selectedShoes) garmentItems.push({ item: selectedShoes, garmentClass: "SHOES", label: "shoes" });

    // Fetch ALL garment images in parallel
    updateTryOnStatus(`Fetching ${garmentItems.length} garment images...`);
    console.log(`[Wardrobe] Fetching ${garmentItems.length} garment images in parallel...`);

    const fetchResults = await Promise.all(
      garmentItems.map(async (g) => {
        // Prefer background-removed image (cleaner, no model) for better identity preservation
        let base64 = null;
        if (g.item._noBgImage) {
          // _noBgImage is a data URL like "data:image/png;base64,..."
          base64 = g.item._noBgImage.split(",")[1] || null;
          console.log(`[Wardrobe] Using bg-removed image for ${g.label}: ${base64?.length || 0} chars`);
        }
        if (!base64) {
          base64 = await sendMessage({ type: "PROXY_IMAGE", url: g.item.image_url });
          console.log(`[Wardrobe] Fetched original image for ${g.label}: ${base64?.length || 0} chars`);
        }
        if (!base64) throw new Error(`Failed to fetch ${g.label} image`);
        return { imageBase64: base64, garmentClass: g.garmentClass, label: g.label };
      })
    );

    // Single API call with all garments
    updateTryOnStatus(`Trying on ${fetchResults.length} garments...`);
    console.log(`[Wardrobe] Sending ${fetchResults.length} garments in a single TRY_ON_OUTFIT call`);

    const result = await sendMessage({
      type: "TRY_ON_OUTFIT",
      bodyImageBase64: null, // backend fetches from S3
      garments: fetchResults,
      framing: "full",
      poseIndex: selectedPoseIndex,
    });

    if (!result || !result.resultImage) {
      throw new Error(result?.error || "Try-on failed — no result image");
    }

    stopTryOnTimer();
    hideTryOnLoading();

    lastTryOnResultBase64 = result.resultImage;
    showTryOnResult(result.resultImage);
    console.log(`[Wardrobe] Outfit try-on complete! (${result.totalTime || "?"})`);

    // Show Save to Favorites button
    const favBtn = document.getElementById("favoriteBtn");
    favBtn.hidden = false;
    favBtn.innerHTML = "&#9825; Save to Favorites";
    favBtn.classList.remove("vw-btn-favorite--saved");

  } catch (err) {
    stopTryOnTimer();
    console.error("[Wardrobe] Try-on failed:", err);
    console.error("[Wardrobe] Error details:", err.message, err.stack);
    updateTryOnStatus("Failed: " + err.message);
    // Show error for 5s then restore
    setTimeout(() => {
      hideTryOnLoading();
      if (userPosePhoto) showUserPhoto(userPosePhoto);
    }, 5000);
  } finally {
    const needShoes = !!shoesQuery;
    const canTryOn = selectedTop && selectedBottom && (!needShoes || selectedShoes);
    btn.disabled = !canTryOn;
    btn.innerHTML = "&#10024; Try On";
  }
}

// ---------------------------------------------------------------------------
// Save to Favorites
// ---------------------------------------------------------------------------
async function handleSaveFavorite() {
  if (!lastTryOnResultBase64 || (!selectedTop && !selectedBottom)) return;

  const favBtn = document.getElementById("favoriteBtn");
  favBtn.disabled = true;
  favBtn.textContent = "Saving...";

  try {
    // Strip data URI prefix if present for the result image
    let resultImage = lastTryOnResultBase64;
    if (resultImage.startsWith("data:")) {
      resultImage = resultImage.split(",")[1] || resultImage;
    }

    // Collect all outfit items
    const outfitItems = [];
    if (selectedTop) outfitItems.push({ item: selectedTop, category: "top", garmentClass: "UPPER_BODY" });
    if (selectedBottom) outfitItems.push({ item: selectedBottom, category: "bottom", garmentClass: "LOWER_BODY" });
    if (selectedShoes) outfitItems.push({ item: selectedShoes, category: "shoes", garmentClass: "SHOES" });

    // Shared outfitId links all items together
    const outfitId = "outfit_" + Date.now();

    console.log(`[Wardrobe] SAVE FAVORITE — ${outfitItems.length} items, outfitId: ${outfitId}`);

    // Save each item (all share the same try-on result image and outfitId)
    for (const { item, category, garmentClass } of outfitItems) {
      const asinMatch = (item.product_url || "").match(/\/dp\/([A-Z0-9]{10})/);
      const asin = asinMatch ? asinMatch[1] : "";
      if (!asin) continue;

      console.log(`[Wardrobe]   saving ${category}: asin=${asin}`);

      await sendMessage({
        type: "API_CALL",
        endpoint: "/api/favorites",
        method: "POST",
        data: {
          asin,
          productTitle: item.title || "",
          productImage: item.image_url || "",
          category,
          garmentClass,
          tryOnResultImage: resultImage,
          outfitId,
        },
      });
    }

    console.log("[Wardrobe] All outfit items saved");
    favBtn.innerHTML = "&#9829; Saved!";
    favBtn.classList.add("vw-btn-favorite--saved");
  } catch (err) {
    console.error("[Wardrobe] Failed to save favorite:", err);
    alert("Failed to save: " + err.message);
    favBtn.innerHTML = "&#9825; Save to Favorites";
  } finally {
    favBtn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// UI Helpers
// ---------------------------------------------------------------------------
function showWardrobe() {
  document.getElementById("loadingOverlay").hidden = true;
  document.getElementById("closetRoom").hidden = false;
  document.getElementById("shoeRackContainer").hidden = false;
}

function updateCategoryStatus(category, status) {
  const map = { top: "loadingTopStatus", bottom: "loadingBottomStatus", shoes: "loadingShoesStatus" };
  const el = document.getElementById(map[category]);
  if (el) el.textContent = status;
}

function showTryOnLoading() {
  document.getElementById("tryOnLoading").hidden = false;
}

function hideTryOnLoading() {
  document.getElementById("tryOnLoading").hidden = true;
}

function updateTryOnStatus(msg) {
  document.getElementById("tryOnStatus").textContent = msg;
}

function startTimer() {
  searchStartTime = Date.now();
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - searchStartTime) / 1000);
    document.getElementById("searchTimer").textContent = "Elapsed: " + elapsed + "s";
  }, 1000);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function startTryOnTimer() {
  const startTime = Date.now();
  const el = document.getElementById("tryOnTimer");
  tryOnTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    el.textContent = elapsed + "s";
  }, 1000);
}

function stopTryOnTimer() {
  if (tryOnTimerInterval) {
    clearInterval(tryOnTimerInterval);
    tryOnTimerInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Image Resize — ensure images fit Nova Canvas [320, 4096] pixel range
// ---------------------------------------------------------------------------
function resizeImageBase64(base64, minDim = 320, maxDim = 4096) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;

      // Check if resize is needed
      if (width >= minDim && width <= maxDim && height >= minDim && height <= maxDim) {
        resolve(base64); // already valid
        return;
      }

      // Scale up if too small
      if (width < minDim || height < minDim) {
        const scale = Math.max(minDim / width, minDim / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      // Scale down if too large
      if (width > maxDim || height > maxDim) {
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, width, height);

      // Return as base64 without data URI prefix
      const dataUrl = canvas.toDataURL("image/png");
      const resized = dataUrl.split(",")[1];
      console.log(`[Wardrobe] Resized image: ${img.naturalWidth}x${img.naturalHeight} → ${width}x${height}`);

      // Release canvas memory
      canvas.width = 0;
      canvas.height = 0;

      resolve(resized);
    };
    img.onerror = () => {
      console.warn("[Wardrobe] Failed to load image for resize, using original");
      resolve(base64);
    };
    // Add data URI prefix if missing
    img.src = base64.startsWith("data:") ? base64 : "data:image/jpeg;base64," + base64;
  });
}

// ---------------------------------------------------------------------------
// Messaging (same pattern as smart-search/results.js)
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
