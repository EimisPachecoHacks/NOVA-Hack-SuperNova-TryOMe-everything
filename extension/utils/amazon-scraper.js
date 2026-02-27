/**
 * NovaTryOnMe - Amazon Product Page Scraper
 *
 * Extracts product information from the DOM of an Amazon product page.
 * Designed to work as a content script loaded before content.js.
 */

/**
 * Scrape product data from the current Amazon product page.
 *
 * @returns {{ imageUrl: string|null, title: string|null, breadcrumbs: string, asin: string|null }}
 */
function scrapeProductData() {
  // ---------------------------------------------------------------------------
  // 1. Product image - try selectors in priority order for highest resolution
  // ---------------------------------------------------------------------------
  let imageUrl = null;

  // Try #landingImage first (main hero image)
  const landingImage = document.querySelector("#landingImage");
  if (landingImage) {
    // data-old-hires has the highest resolution version
    imageUrl =
      landingImage.getAttribute("data-old-hires") ||
      landingImage.getAttribute("data-a-dynamic-image") ||
      landingImage.src;

    // data-a-dynamic-image is a JSON map of url -> [w, h]; pick the largest
    if (!imageUrl || imageUrl.startsWith("{")) {
      try {
        const dynamicMap = JSON.parse(
          landingImage.getAttribute("data-a-dynamic-image") || "{}"
        );
        const urls = Object.entries(dynamicMap);
        if (urls.length) {
          // Sort by width descending and pick the largest
          urls.sort((a, b) => b[1][0] - a[1][0]);
          imageUrl = urls[0][0];
        }
      } catch {
        // Fallback to src
        imageUrl = landingImage.src;
      }
    }
  }

  // Fallback: #imgTagWrapperId img
  if (!imageUrl) {
    const wrapperImg = document.querySelector("#imgTagWrapperId img");
    if (wrapperImg) {
      imageUrl = wrapperImg.getAttribute("data-old-hires") || wrapperImg.src;
    }
  }

  // Fallback: any .a-dynamic-image
  if (!imageUrl) {
    const dynamicImg = document.querySelector(".a-dynamic-image");
    if (dynamicImg) {
      imageUrl = dynamicImg.getAttribute("data-old-hires") || dynamicImg.src;
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Product title
  // ---------------------------------------------------------------------------
  let title = null;
  const titleEl = document.querySelector("#productTitle");
  if (titleEl) {
    title = titleEl.textContent.trim();
  }

  // ---------------------------------------------------------------------------
  // 3. Breadcrumbs (category path)
  // ---------------------------------------------------------------------------
  let breadcrumbs = "";
  const breadcrumbLinks = document.querySelectorAll(
    "#wayfinding-breadcrumbs_container .a-link-normal"
  );
  if (breadcrumbLinks.length) {
    const crumbs = Array.from(breadcrumbLinks)
      .map((el) => el.textContent.trim())
      .filter(Boolean);
    breadcrumbs = crumbs.join(" > ");
  }

  // ---------------------------------------------------------------------------
  // 4. ASIN (Amazon Standard Identification Number)
  // ---------------------------------------------------------------------------
  let asin = null;

  // Try to extract from the URL: /dp/ASIN or /gp/product/ASIN
  const dpMatch = window.location.pathname.match(/\/dp\/([A-Z0-9]{10})/);
  const gpMatch = window.location.pathname.match(
    /\/gp\/product\/([A-Z0-9]{10})/
  );
  if (dpMatch) {
    asin = dpMatch[1];
  } else if (gpMatch) {
    asin = gpMatch[1];
  }

  // Fallback: hidden input field
  if (!asin) {
    const asinInput = document.querySelector('input[name="ASIN"]');
    if (asinInput) {
      asin = asinInput.value;
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Price
  // ---------------------------------------------------------------------------
  let price = null;
  const priceEl = document.querySelector(".a-price .a-offscreen");
  if (priceEl) {
    price = priceEl.textContent.trim();
  }

  return { imageUrl, title, breadcrumbs, asin, price };
}

/**
 * Re-scrape just the current product image URL from #landingImage.
 * Used when a color/variation swatch changes the displayed image.
 *
 * @returns {string|null} The current product image URL, or null if not found.
 */
function scrapeCurrentImageUrl() {
  const landingImage = document.querySelector("#landingImage");
  if (!landingImage) return null;

  let imageUrl =
    landingImage.getAttribute("data-old-hires") ||
    landingImage.getAttribute("data-a-dynamic-image") ||
    landingImage.src;

  if (!imageUrl || imageUrl.startsWith("{")) {
    try {
      const dynamicMap = JSON.parse(
        landingImage.getAttribute("data-a-dynamic-image") || "{}"
      );
      const urls = Object.entries(dynamicMap);
      if (urls.length) {
        urls.sort((a, b) => b[1][0] - a[1][0]);
        imageUrl = urls[0][0];
      }
    } catch {
      imageUrl = landingImage.src;
    }
  }

  return imageUrl || null;
}
