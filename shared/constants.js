const GARMENT_CLASSES = {
  UPPER_BODY: "UPPER_BODY",
  LOWER_BODY: "LOWER_BODY",
  FULL_BODY: "FULL_BODY",
  FOOTWEAR: "FOOTWEAR"
};

const GARMENT_SUB_CLASSES = {
  LONG_SLEEVE_SHIRT: "LONG_SLEEVE_SHIRT",
  SHORT_SLEEVE_SHIRT: "SHORT_SLEEVE_SHIRT",
  NO_SLEEVE_SHIRT: "NO_SLEEVE_SHIRT",
  OTHER_UPPER_BODY: "OTHER_UPPER_BODY",
  LONG_PANTS: "LONG_PANTS",
  SHORT_PANTS: "SHORT_PANTS",
  OTHER_LOWER_BODY: "OTHER_LOWER_BODY",
  LONG_DRESS: "LONG_DRESS",
  SHORT_DRESS: "SHORT_DRESS",
  FULL_BODY_OUTFIT: "FULL_BODY_OUTFIT",
  OTHER_FULL_BODY: "OTHER_FULL_BODY",
  SHOES: "SHOES",
  BOOTS: "BOOTS",
  OTHER_FOOTWEAR: "OTHER_FOOTWEAR"
};

const MERGE_STYLES = {
  BALANCED: "BALANCED",
  SEAMLESS: "SEAMLESS",
  DETAILED: "DETAILED"
};

const COSMETIC_TYPES = {
  lipstick: { maskPrompt: "lips", label: "Lipstick" },
  eyeshadow: { maskPrompt: "eyelids and eye area", label: "Eye Shadow" },
  blush: { maskPrompt: "cheeks", label: "Blush" },
  foundation: { maskPrompt: "face skin", label: "Foundation" },
  eyeliner: { maskPrompt: "eyelid edges", label: "Eyeliner" },
  mascara: { maskPrompt: "eyelashes", label: "Mascara" }
};

const PRODUCT_CATEGORIES = {
  CLOTHING: "clothing",
  FOOTWEAR: "footwear",
  COSMETICS: "cosmetics",
  ACCESSORIES: "accessories",
  UNSUPPORTED: "unsupported"
};

const API_ROUTES = {
  ANALYZE: "/api/analyze",
  TRY_ON: "/api/try-on",
  COSMETICS: "/api/cosmetics",
  VIDEO: "/api/video",
  REMOVE_BG: "/api/image/remove-bg"
};

// Export for both Node.js and browser
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    GARMENT_CLASSES,
    GARMENT_SUB_CLASSES,
    MERGE_STYLES,
    COSMETIC_TYPES,
    PRODUCT_CATEGORIES,
    API_ROUTES
  };
}
