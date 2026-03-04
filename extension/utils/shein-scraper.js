/**
 * NovaTryOnMe - Shein Product Page Scraper
 *
 * Extracts product information from the DOM of a Shein product page.
 * Designed to work as a content script loaded before content.js.
 */

/**
 * Scrape product data from the current Shein product page.
 *
 * @returns {{ imageUrl: string|null, title: string|null, breadcrumbs: string, productId: string|null, price: string|null, retailer: string, productUrl: string }}
 */
function scrapeProductData() {
  // ---------------------------------------------------------------------------
  // 1. Product image — try multiple selectors (Shein changes DOM frequently)
  // ---------------------------------------------------------------------------
  let imageUrl = null;

  // Main product image in the intro section
  const introImg = document.querySelector(".crop-image-container__img") ||
                   document.querySelector(".crop-image-container img") ||
                   document.querySelector(".main-picture img") ||
                   document.querySelector(".atf-left img");

  if (introImg) {
    imageUrl = introImg.src || introImg.getAttribute("data-src");
  }

  // Fallback: look for large images with Shein CDN URLs
  if (!imageUrl) {
    const imgs = Array.from(document.querySelectorAll("img[src*='img.ltwebstatic.com'], img[src*='img.kwcdn.com']"));
    // Pick the first large one (likely the hero image)
    const hero = imgs.find(img => {
      const rect = img.getBoundingClientRect();
      return rect.width > 200 && rect.height > 200;
    });
    if (hero) imageUrl = hero.src;
  }

  // Fallback: any large visible image
  if (!imageUrl) {
    const allImgs = Array.from(document.querySelectorAll("img"));
    const large = allImgs.find(img => img.naturalWidth > 300 && img.naturalHeight > 300);
    if (large) imageUrl = large.src;
  }

  // ---------------------------------------------------------------------------
  // 2. Product title
  // ---------------------------------------------------------------------------
  let title = null;
  const titleEl = document.querySelector(".product-intro__head-name") ||
                  document.querySelector("[class*='product-intro'] h1") ||
                  document.querySelector("h1");
  if (titleEl) {
    title = titleEl.textContent.trim();
  }

  // ---------------------------------------------------------------------------
  // 3. Breadcrumbs
  // ---------------------------------------------------------------------------
  let breadcrumbs = "";
  const crumbEls = document.querySelectorAll(".bread-crumb__inner a, [class*='breadcrumb'] a");
  if (crumbEls.length) {
    breadcrumbs = Array.from(crumbEls)
      .map(el => el.textContent.trim())
      .filter(Boolean)
      .join(" > ");
  }

  // ---------------------------------------------------------------------------
  // 4. Product ID — extract from URL pattern: -p-12345.html or -p-12345-cat-1234.html
  // ---------------------------------------------------------------------------
  let productId = null;
  const pidMatch = window.location.pathname.match(/-p-(\d+)/);
  if (pidMatch) {
    productId = pidMatch[1];
  }

  // Fallback: try to find product ID in page data
  if (!productId) {
    const metaProduct = document.querySelector('meta[name="product-id"], meta[property="product:id"]');
    if (metaProduct) productId = metaProduct.content;
  }

  // ---------------------------------------------------------------------------
  // 5. Price
  // ---------------------------------------------------------------------------
  let price = null;
  const priceEl = document.querySelector(".product-intro__head-price .original, .product-intro__head-mainprice") ||
                  document.querySelector("[class*='product-price']") ||
                  document.querySelector("[class*='Price'] [class*='sale']");
  if (priceEl) {
    price = priceEl.textContent.trim();
  }

  return { imageUrl, title, breadcrumbs, productId, price, retailer: "shein", productUrl: window.location.href };
}

/**
 * Re-scrape just the current product image URL.
 * Used when a color/variation swatch changes the displayed image.
 *
 * @returns {string|null}
 */
function scrapeCurrentImageUrl() {
  const introImg = document.querySelector(".crop-image-container__img") ||
                   document.querySelector(".crop-image-container img") ||
                   document.querySelector(".main-picture img") ||
                   document.querySelector(".atf-left img");

  if (introImg) {
    return introImg.src || introImg.getAttribute("data-src") || null;
  }

  // Fallback: large Shein CDN image
  const imgs = Array.from(document.querySelectorAll("img[src*='img.ltwebstatic.com'], img[src*='img.kwcdn.com']"));
  const hero = imgs.find(img => {
    const rect = img.getBoundingClientRect();
    return rect.width > 200 && rect.height > 200;
  });
  return hero ? hero.src : null;
}
