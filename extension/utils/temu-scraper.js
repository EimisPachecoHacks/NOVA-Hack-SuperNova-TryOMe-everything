/**
 * NovaTryOnMe - Temu Product Page Scraper
 *
 * Extracts product information from the DOM of a Temu product page.
 * Designed to work as a content script loaded before content.js.
 */

/**
 * Scrape product data from the current Temu product page.
 *
 * @returns {{ imageUrl: string|null, title: string|null, breadcrumbs: string, productId: string|null, price: string|null, retailer: string, productUrl: string }}
 */
function scrapeProductData() {
  // ---------------------------------------------------------------------------
  // 1. Product image — Temu uses dynamically-named classes, so we use multiple strategies
  // ---------------------------------------------------------------------------
  let imageUrl = null;

  // Try main product gallery image (Temu uses img.kwcdn.com and fimg.kwcdn.com)
  const kwImgs = Array.from(document.querySelectorAll("img[src*='kwcdn.com'], img[src*='temu.com']"));
  if (kwImgs.length) {
    // Pick the largest visible image (likely the hero)
    const hero = kwImgs.find(img => {
      const rect = img.getBoundingClientRect();
      return rect.width > 200 && rect.height > 200;
    });
    if (hero) imageUrl = hero.src;
    if (!imageUrl) imageUrl = kwImgs[0].src;
  }

  // Fallback: look for images inside known product image containers
  if (!imageUrl) {
    const containerImg = document.querySelector("[class*='ProductImage'] img") ||
                         document.querySelector("[class*='product-image'] img") ||
                         document.querySelector("[class*='gallery'] img") ||
                         document.querySelector("[class*='goodsImage'] img") ||
                         document.querySelector("[class*='goods-image'] img");
    if (containerImg) imageUrl = containerImg.src;
  }

  // Fallback: try to extract from top_gallery_url query param in the page URL
  if (!imageUrl) {
    const params = new URLSearchParams(window.location.search);
    const galleryUrl = params.get("top_gallery_url");
    if (galleryUrl) {
      try { imageUrl = decodeURIComponent(galleryUrl); } catch (_) {}
    }
  }

  // Fallback: any large visible image
  if (!imageUrl) {
    const allImgs = Array.from(document.querySelectorAll("img"));
    const large = allImgs.find(img => {
      const rect = img.getBoundingClientRect();
      return rect.width > 200 && rect.height > 200;
    });
    if (large) imageUrl = large.src;
  }

  // ---------------------------------------------------------------------------
  // 2. Product title
  // ---------------------------------------------------------------------------
  let title = null;
  // Temu uses hashed class names — try h1 first, then look for the title by structure
  const titleEl = document.querySelector("h1");
  if (titleEl) {
    title = titleEl.textContent.trim();
  }
  // Fallback: extract from page title or meta tags
  if (!title) {
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) title = ogTitle.content;
  }
  if (!title) {
    // Page title minus " | Temu ..." suffix
    const pageTitle = document.title.replace(/\s*[\|–—].*Temu.*$/i, "").trim();
    if (pageTitle) title = pageTitle;
  }

  // ---------------------------------------------------------------------------
  // 3. Breadcrumbs
  // ---------------------------------------------------------------------------
  let breadcrumbs = "";
  const crumbEls = document.querySelectorAll("[class*='breadcrumb'] a, nav a");
  if (crumbEls.length) {
    const crumbs = Array.from(crumbEls)
      .map(el => el.textContent.trim())
      .filter(t => t && t.length < 60); // Filter out non-breadcrumb nav links
    if (crumbs.length > 1) {
      breadcrumbs = crumbs.join(" > ");
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Product ID — extract from URL pattern: -g-12345.html or /goods-detail?goods_id=12345
  // ---------------------------------------------------------------------------
  let productId = null;
  const gMatch = window.location.pathname.match(/-g-(\d+)/);
  if (gMatch) {
    productId = gMatch[1];
  }

  // Fallback: try URL query params
  if (!productId) {
    const params = new URLSearchParams(window.location.search);
    productId = params.get("goods_id") || params.get("productId");
  }

  // Fallback: try any numeric ID in the URL path
  if (!productId) {
    const numMatch = window.location.pathname.match(/(\d{6,})/);
    if (numMatch) productId = numMatch[1];
  }

  // ---------------------------------------------------------------------------
  // 5. Price
  // ---------------------------------------------------------------------------
  let price = null;
  const priceEl = document.querySelector("[class*='price'] [class*='sale']") ||
                  document.querySelector("[class*='Price']") ||
                  document.querySelector("[class*='price']");
  if (priceEl) {
    price = priceEl.textContent.trim();
  }

  return { imageUrl, title, breadcrumbs, productId, price, retailer: "temu", productUrl: window.location.href };
}

/**
 * Re-scrape just the current product image URL.
 * Used when a color/variation swatch changes the displayed image.
 *
 * @returns {string|null}
 */
function scrapeCurrentImageUrl() {
  // Try Temu CDN images first
  const kwImgs = Array.from(document.querySelectorAll("img[src*='kwcdn.com'], img[src*='temu.com']"));
  const hero = kwImgs.find(img => {
    const rect = img.getBoundingClientRect();
    return rect.width > 200 && rect.height > 200;
  });
  if (hero) return hero.src;

  // Fallback
  const containerImg = document.querySelector("[class*='ProductImage'] img") ||
                       document.querySelector("[class*='product-image'] img") ||
                       document.querySelector("[class*='goodsImage'] img");
  return containerImg ? containerImg.src : null;
}
