/**
 * NovaTryOnMe - Google Shopping Scraper
 *
 * Extracts product information from Google Shopping product detail views.
 * Google Shopping uses obfuscated class names, so this scraper relies on
 * semantic elements, ARIA labels, and structural position as fallbacks.
 *
 * Designed to work as a content script loaded before content.js.
 */

/**
 * Scrape product data from the current Google Shopping page.
 * Works on both the product detail page and inline detail panels.
 *
 * @returns {{ imageUrl: string|null, title: string|null, breadcrumbs: string, productId: string|null, price: string|null, retailer: string, productUrl: string }}
 */
function scrapeProductData() {
  // ---------------------------------------------------------------------------
  // 1. Product image — try multiple strategies
  // ---------------------------------------------------------------------------
  let imageUrl = null;

  // Strategy 1: Product detail page main image
  const mainImg = document.querySelector("[data-sh-sr] img") ||
                  document.querySelector("[class*='product-viewer'] img") ||
                  document.querySelector("img[data-atf]");
  if (mainImg) {
    imageUrl = mainImg.src;
  }

  // Strategy 2: Look for large product images (not icons/logos)
  if (!imageUrl) {
    const imgs = Array.from(document.querySelectorAll("img"));
    const productImg = imgs.find(img => {
      const rect = img.getBoundingClientRect();
      const src = img.src || "";
      return rect.width > 150 && rect.height > 150 &&
             !src.includes("google.com/favicon") &&
             !src.includes("gstatic.com/images");
    });
    if (productImg) imageUrl = productImg.src;
  }

  // Strategy 3: Look for images with product-related alt text
  if (!imageUrl) {
    const altImgs = Array.from(document.querySelectorAll("img[alt]"));
    const relevant = altImgs.find(img => {
      const alt = img.alt.toLowerCase();
      return alt.length > 5 && !alt.includes("google") && img.naturalWidth > 100;
    });
    if (relevant) imageUrl = relevant.src;
  }

  // ---------------------------------------------------------------------------
  // 2. Product title — try h1, then structured elements
  // ---------------------------------------------------------------------------
  let title = null;

  // Product detail pages often have the title in an h1 or specific heading
  const h1 = document.querySelector("h1");
  if (h1 && h1.textContent.trim().length > 3) {
    title = h1.textContent.trim();
  }

  // Fallback: look for a heading near the main image
  if (!title) {
    const headings = Array.from(document.querySelectorAll("h2, h3, [role='heading']"));
    const productHeading = headings.find(h => {
      const text = h.textContent.trim();
      return text.length > 5 && text.length < 200;
    });
    if (productHeading) title = productHeading.textContent.trim();
  }

  // ---------------------------------------------------------------------------
  // 3. Breadcrumbs
  // ---------------------------------------------------------------------------
  let breadcrumbs = "";
  const crumbEls = document.querySelectorAll("[class*='breadcrumb'] a, nav[aria-label*='Breadcrumb'] a");
  if (crumbEls.length) {
    breadcrumbs = Array.from(crumbEls)
      .map(el => el.textContent.trim())
      .filter(Boolean)
      .join(" > ");
  }

  // ---------------------------------------------------------------------------
  // 4. Product ID — from URL parameters
  // ---------------------------------------------------------------------------
  let productId = null;

  // Google Shopping product pages: /product/12345
  const productPathMatch = window.location.pathname.match(/\/product\/(\d+)/);
  if (productPathMatch) {
    productId = productPathMatch[1];
  }

  // Fallback: prds parameter or other query params
  if (!productId) {
    const params = new URLSearchParams(window.location.search);
    const prds = params.get("prds");
    if (prds) {
      const pidMatch = prds.match(/pid:(\d+)/);
      if (pidMatch) productId = pidMatch[1];
    }
  }

  // Fallback: use a hash of the URL as a stable identifier
  if (!productId) {
    productId = "gshop_" + hashCode(window.location.href);
  }

  // ---------------------------------------------------------------------------
  // 5. Price
  // ---------------------------------------------------------------------------
  let price = null;
  // Google Shopping prices often appear in spans with currency symbols
  const priceEls = Array.from(document.querySelectorAll("span, div"));
  const priceEl = priceEls.find(el => {
    const text = el.textContent.trim();
    return /^\$[\d,.]+$/.test(text) && el.children.length === 0;
  });
  if (priceEl) {
    price = priceEl.textContent.trim();
  }

  return { imageUrl, title, breadcrumbs, productId, price, retailer: "google_shopping", productUrl: window.location.href };
}

/**
 * Re-scrape just the current product image URL.
 *
 * @returns {string|null}
 */
function scrapeCurrentImageUrl() {
  const mainImg = document.querySelector("[data-sh-sr] img") ||
                  document.querySelector("[class*='product-viewer'] img") ||
                  document.querySelector("img[data-atf]");
  if (mainImg) return mainImg.src;

  // Fallback: largest visible non-Google image
  const imgs = Array.from(document.querySelectorAll("img"));
  const productImg = imgs.find(img => {
    const rect = img.getBoundingClientRect();
    const src = img.src || "";
    return rect.width > 150 && rect.height > 150 &&
           !src.includes("google.com/favicon") &&
           !src.includes("gstatic.com/images");
  });
  return productImg ? productImg.src : null;
}

/**
 * Simple string hash for generating stable product IDs from URLs.
 */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}
