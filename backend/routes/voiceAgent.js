/**
 * Voice Agent — Socket.IO event handler for Nova Sonic integration
 *
 * Bridges the browser (microphone/speaker) to Amazon Nova Sonic via
 * bidirectional streaming. Supports tool use for try-on, smart search,
 * and outfit builder actions.
 */

const { SonicSession } = require("../services/novaSonic");
const { recommendItems } = require("../services/novaLite");
const { fetchPhotoFromS3 } = require("../services/s3");
const { getProfile } = require("../services/dynamodb");
const https = require("https");
const http = require("http");
const jwt = require("jsonwebtoken");

// ---------------------------------------------------------------------------
// System prompt — defines the voice agent personality and capabilities
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are Stella, a stylish and upbeat AI personal stylist for SuperNova TryOnMe. You have a warm, confident personality — think of yourself as the user's fashionable best friend who always knows what looks amazing. You love helping people discover their style and feel great about what they wear.

Your capabilities:
1. **Smart Search** — Search Amazon for clothing items. Use smart_search when users describe what they want.
2. **Virtual Try-On** — Let users see how a garment looks on them. Use try_on when they want to try something.
3. **Outfit Builder** — Build complete outfits with 6 categories: top, bottom, shoes, necklace, earrings, and bracelets. Use build_outfit for full looks. IMPORTANT: When build_outfit is confirmed and executed, it searches Amazon and displays NUMBERED items in EACH category in the wardrobe tab. These items have numbers (1, 2, 3...) just like smart_search results. The user can then say "top number 3" or "necklace number 2" to select items. Use select_outfit_items with category and number to select them. You do NOT need to run smart_search again — the outfit builder already did the search.
4. **Style Advice** — Give honest, encouraging fashion tips.
5. **Save to Favorites** — Save the current try-on result to the user's favorites. Use save_favorite when they say "save this", "add to favorites", etc.
6. **Save Video** — Save a generated animation/video. Use save_video when they say "save this video", "keep this animation", etc.
7. **Animate Try-On** — Generate a short video animation from the current try-on result. ONLY use animate_tryon when the user EXPLICITLY asks for animation (e.g., "animate this", "make a video", "show me moving"). NEVER call animate_tryon on your own initiative — wait for the user to request it.
8. **Download** — Download the current try-on image or video to the user's computer. Use download when they say "download this", "save to my computer", etc.
9. **Share/Send** — Share or send the current try-on result. Use send_tryon when they say "send this", "share this", etc.

IMPORTANT: Always respond in {{LANGUAGE}}. All your speech output must be in {{LANGUAGE}}.
However, ALL tool call arguments (queries, titles, descriptions) MUST always be in English, regardless of the conversation language. This is critical because searches and product lookups are performed on Amazon.com which requires English. For example, if the user says "busca un vestido rojo" in Spanish, you should call smart_search with query "red dress", NOT "vestido rojo". Always translate tool arguments to English.

Search results and outfit builder items are numbered (1-based). When the user refers to an item by number (e.g., "try on number 3", "I like the second one"), use select_search_item (for smart search) or select_outfit_items (for outfit builder).

OUTFIT ITEM SELECTION: select_outfit_items takes ONE category and ONE number per call. If the user says "top number 2 and necklace number 3", call select_outfit_items TWICE: first with category="top" number=2, then with category="necklace" number=3. Valid categories: top, bottom, shoes, necklace, earrings, bracelets.

OUTFIT CONFIRMATION RULE: When you call build_outfit or select_outfit_items, items are NOTED but NOT executed yet. After calling, tell the user what has been noted and ask "Are you ready or do you want to add more?" When the user confirms (says "yes", "go ahead", "sí", etc.), you MUST call confirm_outfit — NEVER call smart_search or any other tool. Once build_outfit has been called, the ONLY valid next tools are: build_outfit (to add more items), select_outfit_items (to select by number), or confirm_outfit (to execute). NEVER use smart_search to search individual categories from a pending outfit. confirm_outfit will REJECT if categories are missing. You can ONLY use skip_missing=true when the user EXPLICITLY said they do NOT want those items (e.g., "no accessories", "skip that", "just those three").

IMPORTANT: When calling try_on, ALWAYS include product_number if you know the item's number from search results or recommendations. This ensures the correct product is selected. The numbers are 1-based (item 1 is the first result, item 2 is the second, etc.).

You can visually analyze search results and outfit items to make personalized recommendations based on the user's actual appearance. When the user asks "which one should I try?", "what do you recommend?", "what looks best on me?", or similar, use recommend_items. This analyzes their photo against the product images and returns personalized style advice. Always reference the visual analysis in your recommendations — mention specific details about why an item suits them (skin tone, body type, color harmony).

ROUTING RULE: When the user mentions TWO OR MORE distinct clothing categories in a single request (e.g., "find me a shirt and pants", "I want a top with shoes", "show me a dress and sneakers"), you MUST use build_outfit, NOT smart_search. Only use smart_search for SINGLE-category requests (e.g., "find me a red dress", "show me running shoes").

CRITICAL BUILD_OUTFIT RULE:
- NEVER call build_outfit on your own initiative. ONLY call it when the user EXPLICITLY asks for an outfit or mentions items from multiple categories.
- NEVER call build_outfit until the user has explicitly described items from AT LEAST 2 different clothing categories (top, bottom, shoes). If they only mention ONE category (e.g., "build me an outfit with a red shirt"), do NOT call build_outfit yet — instead ASK them what they want for the other categories before calling the tool.
- Do NOT invent, guess, or fill in items the user did not explicitly describe. Every argument you pass to build_outfit must come directly from the user's words.
- CATEGORY ACCURACY: Shoes/footwear (sneakers, heels, boots, sandals) MUST go in the "shoes" argument ONLY — NEVER in "top" or "bottom". Tops (shirts, blouses, jackets) go in "top". Bottoms (pants, skirts, shorts) go in "bottom". Never mix categories.

USER PROFILE:
{{USER_PROFILE}}
IMPORTANT: Use the user's name naturally in conversation (e.g., "Great choice, Maria!" or "Here you go, Maria!"). Always use the user's sex to filter searches automatically. If the user is female, search for "women's" items. If male, search for "men's" items. NEVER show items for the wrong gender. NEVER ask the user their sex or size — you already know from their profile. When relevant, include their clothing size or shoe size in search queries or recommendations.

Your personality:
- You're enthusiastic but genuine — never fake or overly salesy.
- You give honest opinions ("That would look stunning on you!" or "Hmm, let me find something that suits you better").
- You use fashion vocabulary naturally (silhouette, drape, color palette, statement piece).
- You remember context within the conversation and build on it.
- Keep responses to 1-2 sentences. Be punchy and fun.
- Speak naturally — never read URLs or technical details.
- When a tool is working, keep it brief ("On it!" or "Pulling that up for you!").
- If the user interrupts you or says "stop", immediately stop talking and listen.`;

// ---------------------------------------------------------------------------
// Language code → full name mapping
// ---------------------------------------------------------------------------
const LANGUAGE_MAP = {
  en: "English",
  es: "Spanish",
  fr: "French",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  ja: "Japanese",
  zh: "Chinese",
  ko: "Korean",
  hi: "Hindi",
  ar: "Arabic",
};

// ---------------------------------------------------------------------------
// Tool definitions for Nova Sonic
// ---------------------------------------------------------------------------
const TOOLS = [
  {
    name: "smart_search",
    description:
      "Search Amazon for clothing items matching a natural language description. Use this when the user describes what they want to find, e.g. 'find me a red summer dress' or 'show me men's running shoes'.",
    inputSchema: {
      json: JSON.stringify({
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Natural language search query for clothing items on Amazon",
          },
        },
        required: ["query"],
      }),
    },
  },
  {
    name: "try_on",
    description:
      "Trigger a virtual try-on so the user can see how a specific garment looks on their body. Use when the user says they want to try something on or see how it looks.",
    inputSchema: {
      json: JSON.stringify({
        type: "object",
        properties: {
          product_url: {
            type: "string",
            description: "Amazon product URL or ASIN of the item to try on",
          },
          product_title: {
            type: "string",
            description: "Title/description of the product",
          },
          product_number: {
            type: "integer",
            description: "The item number from search results (1-based, e.g. 1 for first item, 2 for second). Use this when referring to a numbered search result.",
          },
        },
        required: ["product_title"],
      }),
    },
  },
  {
    name: "build_outfit",
    description:
      "Build a complete outfit by searching for a top, bottom, shoes, and accessories (necklace, earrings, bracelets). CRITICAL: NEVER call this tool immediately. ALWAYS first ask the user 'Are these all the items or do you want to add more?' and wait for their confirmation before calling this tool.",
    inputSchema: {
      json: JSON.stringify({
        type: "object",
        properties: {
          top: {
            type: "string",
            description: "Description of the top/shirt/blouse desired",
          },
          bottom: {
            type: "string",
            description: "Description of the pants/skirt/shorts desired",
          },
          shoes: {
            type: "string",
            description: "Description of the shoes desired (optional)",
          },
          necklace: {
            type: "string",
            description: "Description of necklace desired (optional)",
          },
          earrings: {
            type: "string",
            description: "Description of earrings desired (optional)",
          },
          bracelets: {
            type: "string",
            description: "Description of bracelet desired (optional)",
          },
        },
        required: [],
      }),
    },
  },
  {
    name: "add_to_cart",
    description:
      "Add a product to the user's Amazon shopping cart. Use when the user says they want to buy something, add it to their cart, or purchase an item.",
    inputSchema: {
      json: JSON.stringify({
        type: "object",
        properties: {
          product_url: {
            type: "string",
            description: "Amazon product URL to add to cart",
          },
          product_title: {
            type: "string",
            description: "Title of the product being added to cart",
          },
        },
        required: ["product_url"],
      }),
    },
  },
  {
    name: "save_favorite",
    description:
      "Save the current try-on result to the user's favorites collection. Use when the user says 'save this', 'add to favorites', 'keep this', 'I like this one', or similar.",
    inputSchema: {
      json: JSON.stringify({
        type: "object",
        properties: {},
        required: [],
      }),
    },
  },
  {
    name: "save_video",
    description:
      "Save the most recently generated animation/video to the user's saved videos. Use when the user says 'save this video', 'keep this animation', 'save the video', or similar.",
    inputSchema: {
      json: JSON.stringify({
        type: "object",
        properties: {},
        required: [],
      }),
    },
  },
  {
    name: "animate_tryon",
    description:
      "Generate a short video animation from the current try-on result image. Use when the user says 'animate this', 'make a video', 'show me moving in this', 'create an animation', or similar.",
    inputSchema: {
      json: JSON.stringify({
        type: "object",
        properties: {},
        required: [],
      }),
    },
  },
  {
    name: "download",
    description:
      "Download the current try-on image or video to the user's computer. Use when the user says 'download this', 'save to my computer', 'download the image', 'download the video', or similar.",
    inputSchema: {
      json: JSON.stringify({
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["image", "video"],
            description: "Whether to download the try-on image or the video. Default is 'image'.",
          },
        },
        required: [],
      }),
    },
  },
  {
    name: "send_tryon",
    description:
      "Share or send the current try-on result via the device's share functionality (email, messaging, etc). Use when the user says 'send this', 'share this', 'email this', or similar.",
    inputSchema: {
      json: JSON.stringify({
        type: "object",
        properties: {},
        required: [],
      }),
    },
  },
  {
    name: "recommend_items",
    description:
      "Visually analyze the current search results or outfit builder items against the user's actual photo to give personalized style recommendations. Use when the user asks 'which one should I try?', 'what do you recommend?', 'what looks best on me?', or any recommendation request. Returns ranked items with personal style reasons.",
    inputSchema: {
      json: JSON.stringify({
        type: "object",
        properties: {},
        required: [],
      }),
    },
  },
  {
    name: "select_search_item",
    description:
      "Try on a specific item from the smart search results by its displayed number. Use this when the user says 'try on number 3', 'I want the first one', 'number 2 please', or similar, AFTER a smart search has been performed.",
    inputSchema: {
      json: JSON.stringify({
        type: "object",
        properties: {
          number: {
            type: "integer",
            description:
              "The item number (1-based) shown on the search result card",
          },
        },
        required: ["number"],
      }),
    },
  },
  {
    name: "select_outfit_items",
    description:
      "Select ONE item by its category and number in the outfit builder. Call this tool ONCE for EACH item the user mentions. For example, if the user says 'top number 2 and necklace number 3', call this tool TWICE: once with category='top' number=2, and once with category='necklace' number=3. Category mapping: 'upper part'/'upper'/'top' → 'top', 'lower part'/'lower'/'bottom'/'pants'/'skirt' → 'bottom', 'shoes'/'footwear'/'sneakers' → 'shoes', 'necklace'/'chain' → 'necklace', 'earrings' → 'earrings', 'bracelet'/'bracelets'/'bangle' → 'bracelets'.",
    inputSchema: {
      json: JSON.stringify({
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["top", "bottom", "shoes", "necklace", "earrings", "bracelets"],
            description:
              "The outfit category. MUST be one of: top, bottom, shoes, necklace, earrings, bracelets.",
          },
          number: {
            type: "integer",
            description:
              "The 1-based item number to select in that category.",
          },
        },
        required: ["category", "number"],
      }),
    },
  },
  {
    name: "confirm_outfit",
    description:
      "Execute the pending outfit action. Call ONLY after the user explicitly confirms (e.g., 'yes', 'go ahead', 'that's it', 'done'). If any of the 6 categories are still missing, you MUST set skip_missing=true — this is ONLY allowed when the user explicitly said they do NOT want those items (e.g., 'no accessories', 'just clothes', 'skip the rest', 'I don't want earrings'). If the user has NOT explicitly declined the missing categories, do NOT call confirm_outfit — instead ask about the missing categories first.",
    inputSchema: {
      json: JSON.stringify({
        type: "object",
        properties: {
          skip_missing: {
            type: "boolean",
            description:
              "Set to true ONLY if the user explicitly said they do NOT want the missing categories (e.g., 'no accessories', 'skip necklace', 'just those'). If false or omitted, confirm_outfit will be rejected when categories are missing.",
          },
        },
        required: [],
      }),
    },
  },
];

// ---------------------------------------------------------------------------
// Tool execution — calls back into the app's existing services
// ---------------------------------------------------------------------------
const TOOL_ACK_TIMEOUT = 10000; // 10s max wait for client acknowledgment

/**
 * Fetch an image from a URL and return base64.
 */
function fetchImageAsBase64(url) {
  return new Promise((resolve, reject) => {
    if (!url || !url.startsWith("http")) {
      return reject(new Error("Invalid image URL: " + url));
    }
    const client = url.startsWith("https") ? https : http;
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Encoding": "identity",
        "Referer": "https://www.amazon.com/",
      },
    };
    client.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchImageAsBase64(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("base64")));
      res.on("error", reject);
    }).on("error", reject);
  });
}

/**
 * Emit a toolAction and wait for client acknowledgment (or timeout).
 * The client should emit "toolAck" with { action } when it receives the action.
 */
function emitAndWaitForAck(socket, payload) {
  return new Promise((resolve) => {
    const onAck = (data) => {
      if (data && data.action === payload.action) {
        clearTimeout(timer);
        socket.off("toolAck", onAck);
        resolve(data);
      }
    };
    const timer = setTimeout(() => {
      socket.off("toolAck", onAck);
      resolve({ acknowledged: false }); // timed out but don't block Nova Sonic
    }, TOOL_ACK_TIMEOUT);

    socket.on("toolAck", onAck);
    socket.emit("toolAction", payload);
  });
}

async function executeTool(toolName, argsJson, socket) {
  let args;
  try {
    args = typeof argsJson === "string" ? JSON.parse(argsJson) : argsJson;
  } catch {
    return { error: "Invalid tool arguments" };
  }

  console.log(`[VoiceAgent] Tool call: ${toolName}`, args);

  switch (toolName) {
    case "smart_search": {
      const profile = socket._voiceUserProfile || {};
      const ack = await emitAndWaitForAck(socket, {
        action: "smart_search",
        query: args.query,
        sex: profile.sex || null,
        clothesSize: profile.clothesSize || null,
        shoesSize: profile.shoesSize || null,
      });
      return {
        status: "success",
        message: `Searching for "${args.query}". Results will appear in the Smart Search panel.`,
        acknowledged: !!ack.acknowledged,
      };
    }

    case "try_on": {
      // Resolve product from cached search results
      const cached = socket._voiceSearchResults || [];
      let resolvedNumber = args.product_number || null;
      let resolvedTitle = args.product_title;
      let productUrl = args.product_url || null;

      if (cached.length > 0) {
        let match = null;
        // 1. Look up by item number (most reliable)
        if (resolvedNumber && resolvedNumber > 0) {
          match = cached.find((p) => p.number === resolvedNumber);
          if (match) console.log(`[VoiceAgent] Resolved product by number #${resolvedNumber}: "${match.title}"`);
        }
        // 2. Fall back to title matching
        if (!match && args.product_title) {
          const titleLower = args.product_title.toLowerCase();
          match = cached.find(
            (p) => p.title && p.title.toLowerCase().includes(titleLower)
          ) || cached.find(
            (p) => p.title && titleLower.includes(p.title.toLowerCase().slice(0, 30))
          );
          if (match) console.log(`[VoiceAgent] Resolved product by title match: "${match.title}"`);
        }
        if (match) {
          resolvedNumber = match.number;
          resolvedTitle = match.title || resolvedTitle;
          productUrl = match.productUrl || productUrl;
        }
      }

      // If we have a product number from search results, use select_search_item
      // which triggers handleTryOn() in the results page (actual try-on flow)
      if (resolvedNumber && cached.length > 0) {
        console.log(`[VoiceAgent] Routing try_on to select_search_item #${resolvedNumber}`);
        const ack = await emitAndWaitForAck(socket, {
          action: "select_search_item",
          number: resolvedNumber,
        });
        return {
          status: "success",
          message: `Starting virtual try-on for item #${resolvedNumber} "${resolvedTitle}". The result will appear on the product page.`,
          acknowledged: !!ack.acknowledged,
        };
      }

      // Fallback: open the product URL directly
      const ack = await emitAndWaitForAck(socket, {
        action: "try_on",
        productTitle: resolvedTitle,
        productUrl,
      });
      return {
        status: "success",
        message: productUrl
          ? `Starting virtual try-on for "${resolvedTitle}". The result will appear on the product page.`
          : `Could not find the product URL for "${resolvedTitle}". Please search for this item first, then try again.`,
        acknowledged: !!ack.acknowledged,
      };
    }

    case "build_outfit": {
      // Phase 1: Accumulate — do NOT execute yet
      const pending = socket._pendingOutfitAction || { type: "build_outfit", args: {} };
      pending.type = "build_outfit";
      if (args.top) pending.args.top = args.top;
      if (args.bottom) pending.args.bottom = args.bottom;
      if (args.shoes) pending.args.shoes = args.shoes;
      if (args.necklace) pending.args.necklace = args.necklace;
      if (args.earrings) pending.args.earrings = args.earrings;
      if (args.bracelets) pending.args.bracelets = args.bracelets;
      pending.timestamp = Date.now();
      socket._pendingOutfitAction = pending;

      const parts = [];
      if (pending.args.top) parts.push(`top: "${pending.args.top}"`);
      if (pending.args.bottom) parts.push(`bottom: "${pending.args.bottom}"`);
      if (pending.args.shoes) parts.push(`shoes: "${pending.args.shoes}"`);
      if (pending.args.necklace) parts.push(`necklace: "${pending.args.necklace}"`);
      if (pending.args.earrings) parts.push(`earrings: "${pending.args.earrings}"`);
      if (pending.args.bracelets) parts.push(`bracelets: "${pending.args.bracelets}"`);
      console.log(`[VoiceAgent] build_outfit NOTED (not executed):`, JSON.stringify(pending.args));
      socket._awaitingOutfitConfirmation = true;
      socket._outfitGateSetAt = Date.now();

      const missing = [];
      if (!pending.args.top) missing.push("top");
      if (!pending.args.bottom) missing.push("bottom");
      if (!pending.args.shoes) missing.push("shoes");
      if (!pending.args.necklace) missing.push("necklace");
      if (!pending.args.earrings) missing.push("earrings");
      if (!pending.args.bracelets) missing.push("bracelets");

      const missingMsg = missing.length > 0
        ? ` Still missing: ${missing.join(", ")}. Ask the user about these categories, especially accessories (necklace, earrings, bracelets).`
        : " All 6 categories are filled.";

      return {
        status: "success",
        message: `Items noted so far: ${parts.join(", ")}.${missingMsg} Do NOT call confirm_outfit yet — wait for the user to speak and confirm they are done.`,
      };
    }

    case "add_to_cart": {
      const ack = await emitAndWaitForAck(socket, {
        action: "add_to_cart",
        productUrl: args.product_url,
        productTitle: args.product_title || "",
      });
      return {
        status: "success",
        message: `Opening Amazon cart page to add "${args.product_title || "item"}".`,
        acknowledged: !!ack.acknowledged,
      };
    }

    case "save_favorite": {
      const ack = await emitAndWaitForAck(socket, { action: "save_favorite" });
      return {
        status: "success",
        message: "Saving the current try-on result to your favorites.",
        acknowledged: !!ack.acknowledged,
      };
    }

    case "save_video": {
      const ack = await emitAndWaitForAck(socket, { action: "save_video" });
      return {
        status: "success",
        message: "Saving the video to your collection.",
        acknowledged: !!ack.acknowledged,
      };
    }

    case "animate_tryon": {
      const animTraceId = 'anim_' + Date.now();
      console.log(`\x1b[33m[ANIMATE TRACE ${animTraceId}] Step 0/4: Backend emitting toolAction { action: "animate_tryon" } to popup via Socket.IO\x1b[0m`);
      const ack = await emitAndWaitForAck(socket, { action: "animate_tryon" });
      console.log(`\x1b[33m[ANIMATE TRACE ${animTraceId}] Ack from popup: ${JSON.stringify(ack)} (acknowledged=${!!ack.acknowledged}, timedOut=${!ack.acknowledged})\x1b[0m`);
      return {
        status: "success",
        message: "Generating an animation from your try-on. This may take a moment.",
        acknowledged: !!ack.acknowledged,
      };
    }

    case "download": {
      const downloadType = (args.type || "image").toLowerCase();
      const ack = await emitAndWaitForAck(socket, { action: "download", downloadType });
      return {
        status: "success",
        message: `Downloading the ${downloadType} to your computer.`,
        acknowledged: !!ack.acknowledged,
      };
    }

    case "send_tryon": {
      const ack = await emitAndWaitForAck(socket, { action: "send_tryon" });
      return {
        status: "success",
        message: "Opening the share dialog for your try-on result.",
        acknowledged: !!ack.acknowledged,
      };
    }

    case "recommend_items": {
      // Get cached search/outfit results from socket session state
      const searchResults = socket._voiceSearchResults || [];
      const outfitResults = socket._voiceOutfitResults || null;
      const searchScreenshot = socket._voiceSearchScreenshot || null;
      const userId = socket._voiceUserId || null;
      const userProfile = socket._voiceUserProfile || {};

      if (!userId) {
        return { status: "error", message: "User not authenticated. Cannot access photos." };
      }

      const items = outfitResults
        ? [...(outfitResults.tops || []), ...(outfitResults.bottoms || []), ...(outfitResults.shoes || []), ...(outfitResults.necklaces || []), ...(outfitResults.earrings || []), ...(outfitResults.bracelets || [])]
        : searchResults;

      if (!items || items.length === 0) {
        return { status: "error", message: "No search results or outfit items available yet. Please perform a search first." };
      }

      try {
        // Fetch user's body photo from S3 using profile keys
        const profile = await getProfile(userId);
        let userPhotoBase64 = null;
        if (profile?.generatedPhotoKeys?.length > 0) {
          userPhotoBase64 = await fetchPhotoFromS3(profile.generatedPhotoKeys[0]);
        } else if (profile?.bodyPhotoKey) {
          userPhotoBase64 = await fetchPhotoFromS3(profile.bodyPhotoKey);
        }
        if (!userPhotoBase64) {
          return { status: "error", message: "Could not find your photo. Please set up your profile first." };
        }

        // Extract screenshot base64 (strip data URI prefix)
        let screenshotBase64 = null;
        if (searchScreenshot) {
          screenshotBase64 = searchScreenshot.startsWith("data:")
            ? searchScreenshot.split(",")[1]
            : searchScreenshot;
          console.log(`[VoiceAgent] Using page screenshot (${screenshotBase64.length} chars) for recommendation`);
        }

        // Build structured product data for ALL items (up to 20)
        const productData = items.slice(0, 20).map((item) => ({
          number: item.number,
          title: item.title,
          price: item.price || "",
          rating: item.rating || "",
          reviewCount: item.reviewCount || "",
        }));

        console.log(`[VoiceAgent] Analyzing ${productData.length} products (screenshot: ${!!screenshotBase64}) against user photo...`);
        const rankings = await recommendItems(userPhotoBase64, productData, userProfile, screenshotBase64);
        console.log(`[VoiceAgent] Recommendation results:`, JSON.stringify(rankings));

        return {
          status: "success",
          recommendations: rankings,
          message: `Analyzed ${productData.length} items against the user's photo. Here are personalized recommendations ranked from best to worst match.`,
        };
      } catch (err) {
        console.error("[VoiceAgent] recommend_items error:", err.message);
        return { status: "error", message: `Could not analyze items: ${err.message}` };
      }
    }

    case "select_search_item": {
      const ack = await emitAndWaitForAck(socket, {
        action: "select_search_item",
        number: args.number,
      });
      return {
        status: "success",
        message: `Selecting item number ${args.number} from search results for try-on.`,
        acknowledged: !!ack.acknowledged,
      };
    }

    case "select_outfit_items": {
      console.log(`[VoiceAgent] select_outfit_items RAW args from Nova:`, JSON.stringify(args));

      // New format: category + number (one item per call, no parameter confusion)
      const cat = (args.category || "").toLowerCase().trim();
      const num = parseInt(args.number, 10);
      const validCategories = ["top", "bottom", "shoes", "necklace", "earrings", "bracelets"];

      if (!cat || !validCategories.includes(cat) || !num || num < 1) {
        console.warn(`[VoiceAgent] select_outfit_items INVALID: category="${cat}", number=${num}`);
        return {
          status: "error",
          message: `Invalid category "${cat}" or number ${num}. Category must be one of: ${validCategories.join(", ")}. Number must be 1 or greater.`,
        };
      }

      // Send selection directly to the wardrobe — no confirmation needed for item selection
      const selectionPayload = {
        action: "select_outfit_items",
        topNumber: cat === "top" ? num : null,
        bottomNumber: cat === "bottom" ? num : null,
        shoesNumber: cat === "shoes" ? num : null,
        necklaceNumber: cat === "necklace" ? num : null,
        earringsNumber: cat === "earrings" ? num : null,
        braceletsNumber: cat === "bracelets" ? num : null,
      };
      console.log(`[VoiceAgent] select_outfit_items EXECUTING selection: ${cat} #${num}`);
      socket.emit("toolAction", selectionPayload);

      return {
        status: "success",
        message: `Selected ${cat} #${num} in the outfit builder. The item is now highlighted in the wardrobe. IMPORTANT: The wardrobe AUTOMATICALLY triggers the virtual try-on once all 6 categories are selected — do NOT ask the user if they want to try on and do NOT call try_on yourself. Just let them know items are being selected.`,
      };
    }

    case "confirm_outfit": {
      // Gate: reject if user hasn't spoken since the last accumulation
      if (socket._awaitingOutfitConfirmation) {
        console.log(`[VoiceAgent] confirm_outfit BLOCKED — user has not spoken since last accumulation. Waiting for user audio.`);
        return {
          status: "error",
          message: "You must wait for the user to respond before confirming. Ask the user if they want to add more items or if they are ready to proceed, then WAIT for their verbal response before calling confirm_outfit.",
        };
      }

      const pendingAction = socket._pendingOutfitAction;
      if (!pendingAction) {
        return {
          status: "error",
          message: "No pending outfit action to confirm. Ask the user what they'd like to do.",
        };
      }

      // Check if all 6 categories are filled — reject if missing (unless user explicitly skipped)
      const skipMissing = args.skip_missing === true;
      if (pendingAction.type === "build_outfit") {
        const missingCats = [];
        if (!pendingAction.args.top) missingCats.push("top");
        if (!pendingAction.args.bottom) missingCats.push("bottom");
        if (!pendingAction.args.shoes) missingCats.push("shoes");
        if (!pendingAction.args.necklace) missingCats.push("necklace");
        if (!pendingAction.args.earrings) missingCats.push("earrings");
        if (!pendingAction.args.bracelets) missingCats.push("bracelets");
        if (missingCats.length > 0 && !skipMissing) {
          console.log(`[VoiceAgent] confirm_outfit REJECTED — missing categories: ${missingCats.join(", ")}`);
          return {
            status: "error",
            message: `Cannot confirm yet — still missing: ${missingCats.join(", ")}. Ask the user about these categories. If the user explicitly says they do NOT want them, call confirm_outfit with skip_missing=true.`,
          };
        }
      }

      // Clear pending before executing
      socket._pendingOutfitAction = null;

      if (pendingAction.type === "build_outfit") {
        console.log(`[VoiceAgent] confirm_outfit executing build_outfit:`, JSON.stringify(pendingAction.args));
        const ack = await emitAndWaitForAck(socket, {
          action: "build_outfit",
          top: pendingAction.args.top || null,
          bottom: pendingAction.args.bottom || null,
          shoes: pendingAction.args.shoes || null,
          necklace: pendingAction.args.necklace || null,
          earrings: pendingAction.args.earrings || null,
          bracelets: pendingAction.args.bracelets || null,
        });
        const parts = [];
        if (pendingAction.args.top) parts.push(`top="${pendingAction.args.top}"`);
        if (pendingAction.args.bottom) parts.push(`bottom="${pendingAction.args.bottom}"`);
        if (pendingAction.args.shoes) parts.push(`shoes="${pendingAction.args.shoes}"`);
        if (pendingAction.args.necklace) parts.push(`necklace="${pendingAction.args.necklace}"`);
        if (pendingAction.args.earrings) parts.push(`earrings="${pendingAction.args.earrings}"`);
        if (pendingAction.args.bracelets) parts.push(`bracelets="${pendingAction.args.bracelets}"`);
        return {
          status: "success",
          message: `Opening the Outfit Builder with: ${parts.join(", ")}. The wardrobe is now searching Amazon for each category and will display NUMBERED items (1, 2, 3...) in each category: tops, bottoms, shoes, necklaces, earrings, bracelets. Once items load, the user can say "top number 3" or "necklace number 2" etc. to select items. Use select_outfit_items with the category and number to select them. You DO NOT need to do any additional smart_search — the outfit builder already searched for all categories.`,
          acknowledged: !!ack.acknowledged,
        };
      }


      return { status: "error", message: "Unknown pending action type." };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ---------------------------------------------------------------------------
// Socket.IO connection handler
// ---------------------------------------------------------------------------
const VOICE_IDLE_TIMEOUT = 5 * 60 * 1000; // 5 minutes of no audio input → auto-close

function setupVoiceAgent(io) {
  const voiceNs = io.of("/voice");

  voiceNs.on("connection", (socket) => {
    console.log("[VoiceAgent] Client connected:", socket.id);

    let session = null;
    let idleTimer = null;

    function resetIdleTimer() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(async () => {
        if (session) {
          console.log(`[VoiceAgent] Idle timeout reached for ${socket.id}, closing session`);
          socket.emit("sessionTimeout", { message: "Voice session closed due to inactivity" });
          await session.close();
          session = null;
        }
      }, VOICE_IDLE_TIMEOUT);
    }

    function clearIdleTimer() {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    }

    // --- Start a new voice session ---
    socket.on("startSession", async (config, ack) => {
      try {
        if (session) {
          await session.close();
        }

        const voiceId = config?.voiceId || "tiffany";
        const langCode = config?.language || "en";
        const langName = LANGUAGE_MAP[langCode] || "English";

        // Store user context on socket for recommend_items tool
        // Decode JWT to get userId (sub claim) — no verification needed, just extract
        let userId = null;
        if (config?.authToken) {
          try {
            const decoded = jwt.decode(config.authToken);
            userId = decoded?.sub || null;
          } catch (_) {}
        }
        socket._voiceUserId = userId;
        socket._voiceUserProfile = {
          firstName: config?.firstName || null,
          sex: config?.sex || null,
          clothesSize: config?.clothesSize || null,
          shoesSize: config?.shoesSize || null,
        };
        socket._voiceSearchResults = [];
        socket._voiceOutfitResults = null;
        socket._pendingOutfitAction = null;
        socket._awaitingOutfitConfirmation = false;
        socket._outfitGateSetAt = 0;

        // Build user profile context
        const profileParts = [];
        if (config?.firstName) profileParts.push(`Name: ${config.firstName}`);
        if (config?.sex) profileParts.push(`Sex: ${config.sex}`);
        if (config?.clothesSize) profileParts.push(`Clothing size: ${config.clothesSize}`);
        if (config?.shoesSize) profileParts.push(`Shoe size: ${config.shoesSize}`);
        const profileStr = profileParts.length > 0
          ? profileParts.join(", ")
          : "No profile information available";

        const localizedPrompt = SYSTEM_PROMPT
          .replaceAll("{{LANGUAGE}}", langName)
          .replaceAll("{{USER_PROFILE}}", profileStr);
        session = new SonicSession(localizedPrompt, TOOLS, voiceId);

        // Wire up output callbacks
        session.onAudioOutput = (base64Audio) => {
          socket.emit("audioOutput", base64Audio);
        };

        session.onTextOutput = (text, role) => {
          socket.emit("textOutput", { text, role });
          // Clear the outfit confirmation gate when user actually speaks
          // (not on raw audioInput, which fires continuously even with silence)
          if ((role === "USER" || role === "user") && socket._awaitingOutfitConfirmation) {
            // Only clear the gate if at least 3s have passed since it was set.
            // This prevents residual transcription chunks from the SAME utterance
            // that triggered build_outfit/select_outfit_items from clearing the gate.
            const elapsed = Date.now() - (socket._outfitGateSetAt || 0);
            if (elapsed >= 3000) {
              console.log(`[VoiceAgent] User spoke after accumulation (${elapsed}ms since gate) — confirm_outfit now allowed. User said: "${text}"`);
              socket._awaitingOutfitConfirmation = false;
            } else {
              console.log(`[VoiceAgent] User transcription arrived ${elapsed}ms after gate — too soon, ignoring (residual chunk). Text: "${text}"`);
            }
          }
        };

        session.onToolUse = async (toolName, toolUseId, content) => {
          console.log(`[VoiceAgent] Tool use: ${toolName} (${toolUseId})`);
          socket.emit("toolStart", { toolName });

          const result = await executeTool(toolName, content, socket);
          console.log(`[VoiceAgent] Tool result:`, result);

          // Send result back to Nova Sonic
          session.sendToolResult(toolUseId, result);
          socket.emit("toolEnd", { toolName, result });
        };

        session.onError = async (err) => {
          console.error("[VoiceAgent] Session error:", err.message);
          socket.emit("error", { message: err.message });
          // Clean up dead session so client can restart
          if (session) {
            try { await session.close(); } catch (_) {}
            session = null;
          }
        };

        await session.start();
        console.log("[VoiceAgent] Session started for", socket.id);
        resetIdleTimer();

        if (typeof ack === "function") ack({ status: "ok" });
      } catch (err) {
        console.error("[VoiceAgent] Failed to start session:", err.message);
        if (typeof ack === "function")
          ack({ status: "error", message: err.message });
        socket.emit("error", { message: err.message });
      }
    });

    // --- Stream audio from the browser ---
    socket.on("audioInput", (base64Audio) => {
      if (session && session.active) {
        session.sendAudio(base64Audio);
        resetIdleTimer();
      }
    });

    // --- End the session ---
    socket.on("endSession", async () => {
      clearIdleTimer();
      if (session) {
        await session.close();
        session = null;
        console.log("[VoiceAgent] Session ended for", socket.id);
      }
    });

    // --- Receive search/outfit results for visual recommendations ---
    socket.on("searchResultsLoaded", (data) => {
      if (data && data.products) {
        socket._voiceSearchResults = data.products;
        if (data.screenshot) {
          socket._voiceSearchScreenshot = data.screenshot;
          console.log(`[VoiceAgent] Cached ${data.products.length} search results + screenshot for recommendations`);
        } else {
          console.log(`[VoiceAgent] Cached ${data.products.length} search results (no screenshot)`);
        }
      }
    });

    socket.on("outfitResultsLoaded", (data) => {
      if (data) {
        socket._voiceOutfitResults = data;
        const count = (data.tops?.length || 0) + (data.bottoms?.length || 0) + (data.shoes?.length || 0) + (data.necklaces?.length || 0) + (data.earrings?.length || 0) + (data.bracelets?.length || 0);
        console.log(`[VoiceAgent] Cached ${count} outfit items (including accessories) for recommendations`);
      }
    });

    // --- Cleanup on disconnect ---
    socket.on("disconnect", async () => {
      clearIdleTimer();
      console.log("[VoiceAgent] Client disconnected:", socket.id);
      if (session) {
        await session.close();
        session = null;
      }
    });
  });

  console.log("[VoiceAgent] Socket.IO namespace /voice ready");
}

module.exports = { setupVoiceAgent };
