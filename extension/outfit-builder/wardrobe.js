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
let selectedNecklace = null;
let selectedEarrings = null;
let selectedBracelet = null;
let selectedItem = null; // last selected item (for try-on target)
let userPosePhoto = null;
let selectedPoseIndex = 0;
let searchStartTime = 0;
let timerInterval = null;
let tryOnTimerInterval = null;
let lastTryOnResultBase64 = null;
let lastVideoSrc = null;

// ---------------------------------------------------------------------------
// Init — parse URL params, wire events, start searches
// ---------------------------------------------------------------------------
const params = new URLSearchParams(window.location.search);
const topQuery = params.get("top") || "";
const bottomQuery = params.get("bottom") || "";
const shoesQuery = params.get("shoes") || "";
const necklaceQuery = params.get("necklace") || "";
const earringsQuery = params.get("earrings") || "";
const braceletsQuery = params.get("bracelets") || "";
const clothesSizeParam = params.get("clothesSize") || "";
const shoesSizeParam = params.get("shoesSize") || "";
const userSexParam = params.get("sex") || "";
const sexSuffix = userSexParam === "male" ? "for men" : "for women";

// Debug: log exactly what was received from voice agent → sent to Nova Act
console.log(`[Wardrobe] === QUERY DEBUG (sent to Nova Act) ===`);
console.log(`[Wardrobe]   top:       "${topQuery}" → "${topQuery ? topQuery + ' ' + sexSuffix + (clothesSizeParam ? ' size ' + clothesSizeParam : '') : '(skipped)'}"`);
console.log(`[Wardrobe]   bottom:    "${bottomQuery}" → "${bottomQuery ? bottomQuery + ' ' + sexSuffix + (clothesSizeParam ? ' size ' + clothesSizeParam : '') : '(skipped)'}"`);
console.log(`[Wardrobe]   shoes:     "${shoesQuery}" → "${shoesQuery ? shoesQuery + ' ' + sexSuffix + (shoesSizeParam ? ' size ' + shoesSizeParam : '') : '(skipped)'}"`);
console.log(`[Wardrobe]   necklace:  "${necklaceQuery}" → "${necklaceQuery ? necklaceQuery + ' ' + sexSuffix : '(skipped)'}"`);
console.log(`[Wardrobe]   earrings:  "${earringsQuery}" → "${earringsQuery ? earringsQuery + ' ' + sexSuffix : '(skipped)'}"`);
console.log(`[Wardrobe]   bracelets: "${braceletsQuery}" → "${braceletsQuery ? braceletsQuery + ' ' + sexSuffix : '(skipped)'}"`);
console.log(`[Wardrobe] =========================================`);

// Wire event listeners (NO inline handlers)
document.getElementById("tryOnBtn").addEventListener("click", handleTryOn);
document.getElementById("favoriteBtn").addEventListener("click", handleSaveFavorite);
document.getElementById("animateBtn").addEventListener("click", handleAnimate);
document.getElementById("buyBtn").addEventListener("click", handleBuyOnAmazon);
document.getElementById("errorCloseBtn").addEventListener("click", () => window.close());

// Lightbox — click mirror photo or result to view full size
const lightbox = document.getElementById("wardrobeLightbox");
const lightboxImg = document.getElementById("lightboxImg");
function openLightbox(src) {
  lightboxImg.src = src;
  lightbox.classList.add("active");
}
function closeLightbox() {
  lightbox.classList.remove("active");
  lightboxImg.src = "";
}
document.getElementById("lightboxClose").addEventListener("click", closeLightbox);
document.getElementById("lightboxBackdrop").addEventListener("click", closeLightbox);
document.getElementById("mirrorPhoto").addEventListener("click", function () {
  if (this.src) openLightbox(this.src);
});
document.getElementById("mirrorResult").addEventListener("click", function () {
  if (this.src) openLightbox(this.src);
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && lightbox.classList.contains("active")) closeLightbox();
});

// Clean up large base64 data on page unload
window.addEventListener("unload", () => {
  lastTryOnResultBase64 = null;
  userPosePhoto = null;
  selectedTop = null;
  selectedBottom = null;
  selectedShoes = null;
  selectedNecklace = null;
  selectedEarrings = null;
  selectedBracelet = null;
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

  // Show all loading indicators immediately so user sees all 6 categories
  if (necklaceQuery) document.getElementById("loadingNecklace").hidden = false;
  if (earringsQuery) document.getElementById("loadingEarrings").hidden = false;
  if (braceletsQuery) document.getElementById("loadingBracelets").hidden = false;

  // Wave 1: 5 categories + user photo (fits in 4GB RAM)
  const wave1 = [];
  let topSizeStr = "", bottomSizeStr = "", shoesSizeStr = "";

  if (topQuery) {
    topSizeStr = clothesSizeParam ? ` size ${clothesSizeParam}` : "";
    wave1.push(searchCategory("top", `${topQuery} ${sexSuffix}${topSizeStr}`));
  } else {
    updateCategoryStatus("top", "Skipped");
  }

  if (bottomQuery) {
    bottomSizeStr = clothesSizeParam ? ` size ${clothesSizeParam}` : "";
    wave1.push(searchCategory("bottom", `${bottomQuery} ${sexSuffix}${bottomSizeStr}`));
  } else {
    updateCategoryStatus("bottom", "Skipped");
  }

  if (shoesQuery) {
    shoesSizeStr = shoesSizeParam ? ` size ${shoesSizeParam}` : "";
    wave1.push(searchCategory("shoes", `${shoesQuery} ${sexSuffix}${shoesSizeStr}`));
  } else {
    updateCategoryStatus("shoes", "Skipped");
  }

  if (necklaceQuery) {
    wave1.push(searchCategory("necklace", `${necklaceQuery} ${sexSuffix}`));
  }
  if (earringsQuery) {
    wave1.push(searchCategory("earrings", `${earringsQuery} ${sexSuffix}`));
  }

  wave1.push(loadUserPhoto());
  await Promise.allSettled(wave1);
  console.log(`[Wardrobe] Wave 1 (5 categories) complete — ${((Date.now() - searchStartTime) / 1000).toFixed(1)}s`);

  // Wave 2: last accessory after wave 1 frees memory (transparent to user — loading indicator already showing)
  if (braceletsQuery) {
    await Promise.allSettled([searchCategory("bracelets", `${braceletsQuery} ${sexSuffix}`)]);
    console.log(`[Wardrobe] Wave 2 (bracelets) complete — ${((Date.now() - searchStartTime) / 1000).toFixed(1)}s`);
  }

  console.log(`[Wardrobe] All searches complete — ${((Date.now() - searchStartTime) / 1000).toFixed(1)}s elapsed`);

  stopTimer();
  showWardrobe();

  // Send outfit item data to voice agent for visual recommendations
  try {
    function extractItems(containerId, selector) {
      const container = document.getElementById(containerId);
      if (!container) return [];
      const items = container.querySelectorAll(selector);
      return Array.from(items).map((el, i) => {
        const product = el._productData;
        return product ? {
          number: i + 1,
          title: product.title || "",
          imageUrl: product.image_url || "",
          price: product.price || "",
        } : null;
      }).filter(Boolean);
    }
    chrome.runtime.sendMessage({
      type: "OUTFIT_RESULTS_LOADED",
      tops: extractItems("topsContainer", ".hanger-item"),
      bottoms: extractItems("bottomsContainer", ".hanger-item"),
      shoes: extractItems("shoesContainer", ".shoe-display"),
      necklaces: extractItems("necklaceContainer", ".accessory-item"),
      earrings: extractItems("earringsContainer", ".accessory-item"),
      bracelets: extractItems("braceletsContainer", ".accessory-item"),
    });
  } catch (_) { /* popup may not be open */ }
}

async function searchCategory(category, query) {
  const catStart = Date.now();
  updateCategoryStatus(category, "Searching...");
  console.log(`[Wardrobe] ${category}: starting search for "${query}"`);

  try {
    const result = await sendMessage({
      type: "SMART_SEARCH",
      query: query,
    });

    const searchTime = ((Date.now() - catStart) / 1000).toFixed(1);

    if (!result || result.error) {
      updateCategoryStatus(category, "Failed");
      console.error(`[Wardrobe] ${category} search failed (${searchTime}s):`, result?.error);
      return;
    }

    const products = result.products || [];
    updateCategoryStatus(category, products.length + " found, removing backgrounds...");
    console.log(`[Wardrobe] ${category}: ${products.length} products found (${searchTime}s)`);

    // Tag each product with its category
    products.forEach((p) => {
      p._category = category;
    });

    // Accessories: skip background removal, smaller batch
    const isAccessory = ["necklace", "earrings", "bracelets"].includes(category);

    // Remove backgrounds from product images using Nova Canvas
    // Process in batches of 3 to avoid API rate limiting
    const maxItems = isAccessory ? 5 : (category === "shoes" ? 7 : 20);
    const items = products.slice(0, maxItems);

    // Skip background removal for accessories — not needed for small jewelry images
    if (isAccessory) {
      updateCategoryStatus(category, items.length + " ready");
      renderCategory(category, products);
      // Show the accessory bar (shared container for all 3 categories)
      document.getElementById("accessoryBar").hidden = false;
      document.getElementById("closetCeiling").classList.add("has-accessories");
      return;
    }

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
    const bgTime = ((Date.now() - catStart) / 1000).toFixed(1);
    console.log(`[Wardrobe] ${category}: ${bgSuccessCount}/${items.length} backgrounds removed, total ${bgTime}s`);

    updateCategoryStatus(category, products.length + " ready");
    renderCategory(category, products);
  } catch (err) {
    const errTime = ((Date.now() - catStart) / 1000).toFixed(1);
    console.error(`[Wardrobe] ${category} search error (${errTime}s):`, err);
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
  const containerMap = {
    top: "topsContainer",
    bottom: "bottomsContainer",
    shoes: "shoesContainer",
    necklace: "necklaceContainer",
    earrings: "earringsContainer",
    bracelets: "braceletsContainer",
  };
  const maxMap = { top: 20, bottom: 20, shoes: 7, necklace: 5, earrings: 5, bracelets: 5 };
  const containerId = containerMap[category] || "topsContainer";
  const maxItems = maxMap[category] || 20;

  const container = document.getElementById(containerId);
  container.innerHTML = "";

  const items = products.slice(0, maxItems);
  const isAccessory = ["necklace", "earrings", "bracelets"].includes(category);

  items.forEach((product, idx) => {
    if (isAccessory) {
      container.appendChild(createAccessoryItem(product, idx + 1));
    } else if (category === "shoes") {
      container.appendChild(createShoeItem(product, idx + 1));
    } else {
      container.appendChild(createHangerItem(product, idx + 1));
    }
  });
}

function createHangerItem(product, displayNumber) {
  const wrapper = document.createElement("div");
  wrapper.className = "hanger-item";
  wrapper._productData = product;
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
  const tooltipText = (product.title || "Item") + (product.price ? ` — ${product.price}` : "");
  card.title = tooltipText;

  // Number badge
  if (displayNumber) {
    const numberBadge = document.createElement("div");
    numberBadge.className = "item-number-badge";
    numberBadge.textContent = displayNumber;
    card.appendChild(numberBadge);
  }

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

function createShoeItem(product, displayNumber) {
  const wrapper = document.createElement("div");
  wrapper.className = "shoe-display";
  wrapper._productData = product;
  wrapper.addEventListener("click", () => selectItem(product, wrapper));

  const item = document.createElement("div");
  item.className = "shoe-item";
  const tooltipText = (product.title || "Shoes") + (product.price ? ` — ${product.price}` : "");
  wrapper.title = tooltipText;

  // Number badge
  if (displayNumber) {
    const numberBadge = document.createElement("div");
    numberBadge.className = "item-number-badge shoe-number-badge";
    numberBadge.textContent = displayNumber;
    wrapper.appendChild(numberBadge);
  }

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

  // Price badge for shoes
  if (product.price) {
    const price = document.createElement("div");
    price.className = "shoe-price";
    price.textContent = product.price;
    wrapper.appendChild(price);
  }

  const title = document.createElement("div");
  title.className = "shoe-title";
  title.textContent = product.title
    ? product.title.split(" ").slice(0, 3).join(" ")
    : "Shoes";
  wrapper.appendChild(title);

  return wrapper;
}

function createAccessoryItem(product, displayNumber) {
  const wrapper = document.createElement("div");
  wrapper.className = "accessory-item";
  wrapper._productData = product;
  wrapper.addEventListener("click", () => selectItem(product, wrapper));
  wrapper.title = (product.title || "Accessory") + (product.price ? ` — ${product.price}` : "");

  // Number badge
  if (displayNumber) {
    const badge = document.createElement("div");
    badge.className = "accessory-number-badge";
    badge.textContent = displayNumber;
    wrapper.appendChild(badge);
  }

  // Image container
  const imgContainer = document.createElement("div");
  imgContainer.className = "accessory-item-img";
  const img = document.createElement("img");
  img.src = product.image_url || "";
  img.alt = product.title || "";
  img.loading = "lazy";
  img.addEventListener("error", function () { this.style.display = "none"; });
  imgContainer.appendChild(img);
  wrapper.appendChild(imgContainer);

  // Price badge
  if (product.price) {
    const price = document.createElement("div");
    price.className = "accessory-item-price";
    price.textContent = product.price;
    wrapper.appendChild(price);
  }

  // Title
  const title = document.createElement("div");
  title.className = "accessory-item-title";
  title.textContent = product.title ? product.title.split(" ").slice(0, 3).join(" ") : "Accessory";
  wrapper.appendChild(title);

  return wrapper;
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------
function selectItem(product, element) {
  const category = product._category;

  // Remove previous selection in SAME category only
  const containerMap = { top: "topsContainer", bottom: "bottomsContainer", shoes: "shoesContainer", necklace: "necklaceContainer", earrings: "earringsContainer", bracelets: "braceletsContainer" };
  const container = document.getElementById(containerMap[category]);
  if (container) {
    container.querySelectorAll(".hanger-item.selected, .shoe-display.selected, .accessory-item.selected")
      .forEach((el) => el.classList.remove("selected"));
  }

  // Highlight new selection
  element.classList.add("selected");

  // Store per-category selection
  if (category === "top") selectedTop = product;
  else if (category === "bottom") selectedBottom = product;
  else if (category === "shoes") selectedShoes = product;
  else if (category === "necklace") selectedNecklace = product;
  else if (category === "earrings") selectedEarrings = product;
  else if (category === "bracelets") selectedBracelet = product;

  selectedItem = product;

  // Update info bar
  document.getElementById("selectedInfo").hidden = false;
  const parts = [];
  if (selectedTop) parts.push("Top: " + (selectedTop.title || "Item").split(" ").slice(0, 3).join(" "));
  if (selectedBottom) parts.push("Bottom: " + (selectedBottom.title || "Item").split(" ").slice(0, 3).join(" "));
  if (selectedShoes) parts.push("Shoes: " + (selectedShoes.title || "Item").split(" ").slice(0, 3).join(" "));
  if (selectedNecklace) parts.push("Necklace");
  if (selectedEarrings) parts.push("Earrings");
  if (selectedBracelet) parts.push("Bracelet");
  document.getElementById("selectedName").textContent = parts.join(" | ");

  // Calculate total price of all selected items
  let totalPrice = 0;
  [selectedTop, selectedBottom, selectedShoes, selectedNecklace, selectedEarrings, selectedBracelet].forEach(item => {
    if (item && item.price) {
      const num = parseFloat(item.price.replace(/[^0-9.]/g, ""));
      if (!isNaN(num)) totalPrice += num;
    }
  });
  document.getElementById("selectedPrice").textContent = totalPrice > 0 ? `Total: $${totalPrice.toFixed(2)}` : "";

  // Check if Try On should be enabled:
  // Must have both top AND bottom selected, plus shoes if shoes category is present
  const needShoes = !!shoesQuery;
  const canTryOn = selectedTop && selectedBottom && (!needShoes || selectedShoes);
  document.getElementById("tryOnBtn").disabled = !canTryOn;

  // Show buy button when at least one item is selected
  const buyBtn = document.getElementById("buyBtn");
  if (selectedTop || selectedBottom || selectedShoes || selectedNecklace || selectedEarrings || selectedBracelet) {
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

    // Build the list of garments to try on (clothing + accessories)
    const garmentItems = [];
    if (selectedTop) garmentItems.push({ item: selectedTop, garmentClass: "UPPER_BODY", label: "upper wear" });
    if (selectedBottom) garmentItems.push({ item: selectedBottom, garmentClass: "LOWER_BODY", label: "lower wear" });
    if (selectedShoes) garmentItems.push({ item: selectedShoes, garmentClass: "SHOES", label: "shoes" });
    if (selectedNecklace) garmentItems.push({ item: selectedNecklace, garmentClass: "NECKLACE", label: "necklace" });
    if (selectedEarrings) garmentItems.push({ item: selectedEarrings, garmentClass: "EARRINGS", label: "earrings" });
    if (selectedBracelet) garmentItems.push({ item: selectedBracelet, garmentClass: "BRACELET", label: "bracelet" });

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

    // Show Save to Favorites + Animate buttons
    const favBtn = document.getElementById("favoriteBtn");
    favBtn.hidden = false;
    favBtn.innerHTML = "&#9825; Save to Favorites";
    favBtn.classList.remove("vw-btn-favorite--saved");

    const animBtn = document.getElementById("animateBtn");
    animBtn.hidden = false;
    animBtn.innerHTML = "&#9654; Animate";
    animBtn.disabled = false;

  } catch (err) {
    stopTryOnTimer();
    const errMsg = err.message || String(err);
    let userFriendlyMsg = errMsg;
    if (errMsg.includes("503") || errMsg.includes("UNAVAILABLE") || errMsg.includes("high demand")) {
      userFriendlyMsg = "Gemini AI is temporarily overloaded. Please try again in a moment.";
      console.error("[Wardrobe] Try-on failed: Gemini API 503 — model overloaded");
    } else if (errMsg.includes("500")) {
      userFriendlyMsg = "Server error during try-on. Please try again.";
      console.error("[Wardrobe] Try-on failed: Server error 500");
    } else {
      console.error("[Wardrobe] Try-on failed:", errMsg);
    }
    console.error("[Wardrobe] Full error:", err.message, err.stack);
    updateTryOnStatus(userFriendlyMsg);
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
// Buy on Amazon — add all selected items to cart in one click
// ---------------------------------------------------------------------------
function handleBuyOnAmazon() {
  const items = [selectedTop, selectedBottom, selectedShoes, selectedNecklace, selectedEarrings, selectedBracelet].filter(Boolean);
  if (items.length === 0) return;

  // Extract ASINs from product URLs or item data
  const asins = items.map(item => {
    if (item.asin) return item.asin;
    if (item.productId) return item.productId;
    // Extract ASIN from Amazon URL: /dp/ASIN or /gp/product/ASIN
    const url = item.product_url || "";
    const match = url.match(/\/(?:dp|gp\/product)\/([A-Za-z0-9]{10})/);
    if (match) return match[1];
    // Try data-asin pattern in URL params
    const asinParam = url.match(/[?&]asin=([A-Za-z0-9]{10})/i);
    return asinParam ? asinParam[1] : null;
  }).filter(Boolean);

  console.log("[Wardrobe] Add to cart — items:", items.length, "ASINs:", asins);

  if (asins.length > 0) {
    // Use Amazon's bulk add-to-cart URL — adds all items in one request
    const params = asins.map((asin, i) => `ASIN.${i + 1}=${asin}&Quantity.${i + 1}=1`).join("&");
    const cartUrl = `https://www.amazon.com/gp/aws/cart/add.html?${params}`;
    console.log("[Wardrobe] Cart URL:", cartUrl);
    window.open(cartUrl, "_blank");
  } else {
    // Fallback: open product pages if ASINs not found
    console.warn("[Wardrobe] No ASINs found, opening product pages instead");
    items.forEach(item => {
      if (item.product_url) window.open(item.product_url, "_blank");
    });
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
    if (selectedNecklace) outfitItems.push({ item: selectedNecklace, category: "necklace", garmentClass: "NECKLACE" });
    if (selectedEarrings) outfitItems.push({ item: selectedEarrings, category: "earrings", garmentClass: "EARRINGS" });
    if (selectedBracelet) outfitItems.push({ item: selectedBracelet, category: "bracelets", garmentClass: "BRACELET" });

    // Shared outfitId links all items together
    const outfitId = "outfit_" + Date.now();

    console.log(`[Wardrobe] SAVE FAVORITE — ${outfitItems.length} items, outfitId: ${outfitId}`);

    // Save each item (all share the same try-on result image and outfitId)
    for (const { item, category, garmentClass } of outfitItems) {
      const asinMatch = (item.product_url || "").match(/\/dp\/([A-Z0-9]{10})/);
      const productId = asinMatch ? asinMatch[1] : (item.productId || ("outfit_item_" + Date.now() + "_" + category));

      console.log(`[Wardrobe]   saving ${category}: productId=${productId}`);

      await sendMessage({
        type: "API_CALL",
        endpoint: "/api/favorites",
        method: "POST",
        data: {
          asin: productId,
          productTitle: item.title || "",
          productImage: item.image_url || "",
          productUrl: item.product_url || "",
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
  // Adjust padding-top to account for the accessories ceiling height
  const ceiling = document.getElementById("closetCeiling");
  if (ceiling.classList.contains("has-accessories")) {
    requestAnimationFrame(() => {
      const ceilingHeight = ceiling.offsetHeight;
      document.getElementById("closetRoom").style.paddingTop = (ceilingHeight + 8) + "px";
    });
  }
}

function updateCategoryStatus(category, status) {
  const map = { top: "loadingTopStatus", bottom: "loadingBottomStatus", shoes: "loadingShoesStatus", necklace: "loadingNecklaceStatus", earrings: "loadingEarringsStatus", bracelets: "loadingBraceletsStatus" };
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
// Save Video — mirrors handleSaveFavorite, saves directly via API_CALL
// ---------------------------------------------------------------------------
async function handleSaveVideo() {
  if (!lastVideoSrc) return;

  // Collect all outfit items (same as handleSaveFavorite)
  const allOutfitItems = [selectedTop, selectedBottom, selectedShoes, selectedNecklace, selectedEarrings, selectedBracelet].filter(Boolean);
  const outfitItems = allOutfitItems.map(i => {
    const asinMatch = (i.product_url || "").match(/\/dp\/([A-Z0-9]{10})/);
    return {
      asin: asinMatch ? asinMatch[1] : (i.productId || ""),
      productTitle: i.title || "",
      productImage: i.image_url || "",
      productUrl: i.product_url || "",
    };
  });

  let videoBase64 = null;
  let videoUrl = null;
  if (lastVideoSrc.startsWith("data:")) {
    videoBase64 = lastVideoSrc.split(",")[1];
  } else {
    videoUrl = lastVideoSrc;
  }

  const productTitle = allOutfitItems.map(i => (i.title || "").split(" ").slice(0, 3).join(" ")).join(" + ");

  console.log(`[Wardrobe] SAVE VIDEO — ${outfitItems.length} outfitItems, title: "${productTitle.substring(0, 50)}"`);

  try {
    await sendMessage({
      type: "API_CALL",
      method: "POST",
      endpoint: "/api/video/save",
      data: {
        videoBase64,
        videoUrl,
        productTitle,
        outfitItems,
        retailer: "amazon",
      },
    });
    console.log("[Wardrobe] Video saved successfully");
  } catch (err) {
    console.error("[Wardrobe] Save video failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Animate — generate video from try-on result
// ---------------------------------------------------------------------------
async function handleAnimate() {
  if (!lastTryOnResultBase64) return;
  const btn = document.getElementById("animateBtn");
  btn.disabled = true;
  btn.textContent = "Generating video... 0s";

  const videoStart = Date.now();
  const timerInterval = setInterval(() => {
    btn.textContent = "Generating video... " + ((Date.now() - videoStart) / 1000).toFixed(0) + "s";
  }, 1000);

  try {
    const response = await sendMessage({ type: "GENERATE_VIDEO", imageBase64: lastTryOnResultBase64 });
    const jobId = response.jobId;
    const provider = response.provider || "grok";

    // Poll for completion
    const MAX_POLLS = 60;
    let videoResult;
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const status = await sendMessage({ type: "GET_VIDEO_STATUS", jobId, provider });
      if ((status.status === "Completed" || status.status === "COMPLETED") && (status.videoUrl || status.videoBase64)) {
        videoResult = status;
        break;
      }
      if (status.status === "Failed" || status.status === "FAILED") {
        throw new Error(status.failureMessage || "Video generation failed");
      }
    }
    if (!videoResult) throw new Error("Video generation timed out");

    clearInterval(timerInterval);
    const elapsed = ((Date.now() - videoStart) / 1000).toFixed(1);

    const videoSrc = videoResult.videoBase64
      ? "data:" + (videoResult.videoMimeType || "video/mp4") + ";base64," + videoResult.videoBase64
      : videoResult.videoUrl;

    // Display video inside the mirror area, replacing the result image
    const mirrorContent = document.getElementById("mirrorContent");
    const mirrorPhoto = document.getElementById("mirrorPhoto");
    const mirrorResult = document.getElementById("mirrorResult");
    if (mirrorPhoto) mirrorPhoto.hidden = true;
    if (mirrorResult) mirrorResult.hidden = true;

    let videoContainer = document.getElementById("videoContainer");
    if (videoContainer) videoContainer.remove();
    videoContainer = document.createElement("div");
    videoContainer.id = "videoContainer";
    videoContainer.style.cssText = "width:100%;height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;";

    const video = document.createElement("video");
    video.controls = true;
    video.autoplay = true;
    video.loop = true;
    video.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:3px;";
    video.innerHTML = '<source src="' + videoSrc + '" type="video/mp4" />';
    videoContainer.appendChild(video);
    mirrorContent.appendChild(videoContainer);

    // Update Animate button to Save Video
    btn.innerHTML = "&#128190; Save Video";
    btn.disabled = false;
    lastVideoSrc = videoSrc;

    // Collect all outfit items for video metadata
    const allOutfitItems = [selectedTop, selectedBottom, selectedShoes, selectedNecklace, selectedEarrings, selectedBracelet].filter(Boolean);
    const outfitItemsForVideo = allOutfitItems.map(i => {
      const asinMatch = (i.product_url || "").match(/\/dp\/([A-Z0-9]{10})/);
      return {
        asin: asinMatch ? asinMatch[1] : (i.productId || ""),
        productTitle: i.title || "",
        productImage: i.image_url || "",
        productUrl: i.product_url || "",
      };
    });

    // Store last video context for voice "save video" command
    chrome.storage.local.set({
      lastVideo: {
        videoUrl: videoSrc.startsWith("data:") ? null : videoSrc,
        videoBase64: videoSrc.startsWith("data:") ? videoSrc.split(",")[1] : null,
        productId: "",
        productTitle: allOutfitItems.map(i => (i.title || "").split(" ").slice(0, 3).join(" ")).join(" + "),
        productImage: "",
        outfitItems: outfitItemsForVideo,
        timestamp: Date.now(),
      }
    });

    // Replace click handler to save
    btn.replaceWith(btn.cloneNode(true));
    const newBtn = document.getElementById("animateBtn");
    newBtn.innerHTML = "&#128190; Save Video";
    newBtn.addEventListener("click", async () => {
      newBtn.disabled = true;
      newBtn.textContent = "Saving...";
      try {
        // Get video as base64
        let videoBase64 = null;
        let videoUrlForSave = null;
        if (videoSrc.startsWith("data:")) {
          videoBase64 = videoSrc.split(",")[1];
        } else {
          videoUrlForSave = videoSrc;
        }
        await sendMessage({
          type: "API_CALL",
          method: "POST",
          endpoint: "/api/video/save",
          data: {
            videoBase64,
            videoUrl: videoUrlForSave,
            productTitle: allOutfitItems.map(i => (i.title || "").split(" ").slice(0, 3).join(" ")).join(" + "),
            outfitItems: outfitItemsForVideo,
          },
        });
        newBtn.innerHTML = "&#9989; Saved!";
        setTimeout(() => { newBtn.innerHTML = "&#9654; Animate"; }, 3000);
      } catch (err) {
        console.error("[Wardrobe] Save video failed:", err);
        newBtn.textContent = "Save failed";
        setTimeout(() => { newBtn.innerHTML = "&#9654; Animate"; }, 2000);
      } finally {
        newBtn.disabled = false;
      }
    });
  } catch (err) {
    clearInterval(timerInterval);
    console.error("[Wardrobe] Video generation failed:", err);
    btn.innerHTML = "&#9654; Animate";
    btn.disabled = false;
  }
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

// ---------------------------------------------------------------------------
// Voice Agent — listen for outfit item selection commands
// ---------------------------------------------------------------------------
let _voiceSelectTryOnTimer = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "VOICE_SELECT_OUTFIT_ITEMS") {
    console.log("[Wardrobe] Voice selecting items:", message);

    function selectByNumber(containerId, number, category) {
      const container = document.getElementById(containerId);
      if (!container || !number) return;
      const accessoryCategories = ["necklace", "earrings", "bracelets"];
      let selector = ".hanger-item";
      if (category === "shoes") selector = ".shoe-display";
      else if (accessoryCategories.includes(category)) selector = ".accessory-item";
      const items = container.querySelectorAll(selector);
      const idx = number - 1;
      if (idx >= 0 && idx < items.length) {
        items[idx].click();
      } else {
        console.warn("[Wardrobe] Invalid " + category + " number:", number);
      }
    }

    if (message.topNumber) selectByNumber("topsContainer", message.topNumber, "top");
    if (message.bottomNumber) selectByNumber("bottomsContainer", message.bottomNumber, "bottom");
    if (message.shoesNumber) selectByNumber("shoesContainer", message.shoesNumber, "shoes");
    if (message.necklaceNumber) selectByNumber("necklaceContainer", message.necklaceNumber, "necklace");
    if (message.earringsNumber) selectByNumber("earringsContainer", message.earringsNumber, "earrings");
    if (message.braceletsNumber) selectByNumber("braceletsContainer", message.braceletsNumber, "bracelets");

    // Do NOT auto-trigger try-on — let the voice agent ask the user for confirmation first.
    // The agent will send VOICE_CLICK_TRY_ON when the user confirms.
    const allSelected = selectedTop && selectedBottom && selectedShoes && selectedNecklace && selectedEarrings && selectedBracelet;
    if (allSelected) {
      console.log("[Wardrobe] All 6 categories selected — waiting for user confirmation via voice agent.");
    } else {
      console.log("[Wardrobe] Voice selection update — not all 6 yet.",
        "top:", !!selectedTop, "bottom:", !!selectedBottom, "shoes:", !!selectedShoes,
        "necklace:", !!selectedNecklace, "earrings:", !!selectedEarrings, "bracelet:", !!selectedBracelet);
    }

    sendResponse({ status: "ok" });
  }

  // Voice-triggered outfit try-on
  if (message.type === "VOICE_OUTFIT_TRYON") {
    console.log("[Wardrobe] Voice outfit try-on triggered");
    handleTryOn();
    sendResponse({ status: "ok", action: "outfit_tryon" });
  }

  // Voice-triggered animate
  if (message.type === "VOICE_CLICK_ANIMATE") {
    console.log("[Wardrobe] Voice animate triggered");
    if (lastTryOnResultBase64) {
      handleAnimate();
      sendResponse({ status: "ok", action: "animate" });
    } else {
      console.warn("[Wardrobe] Voice animate — no try-on result yet");
      sendResponse({ status: "error", error: "No try-on result to animate" });
    }
  }

  // Voice-triggered save favorite
  if (message.type === "VOICE_SAVE_FAVORITE") {
    console.log("[Wardrobe] Voice save favorite triggered");
    if (lastTryOnResultBase64) {
      handleSaveFavorite();
      sendResponse({ status: "ok", action: "save_favorite" });
    } else {
      sendResponse({ status: "error", error: "No try-on result to save" });
    }
  }

  // Voice-triggered save video (same pattern as VOICE_SAVE_FAVORITE — wardrobe has all the data)
  if (message.type === "VOICE_SAVE_VIDEO") {
    console.log("[Wardrobe] Voice save video triggered");
    if (lastVideoSrc) {
      handleSaveVideo();
      sendResponse({ status: "ok", action: "save_video" });
    } else {
      sendResponse({ status: "error", error: "No video to save" });
    }
  }
});
