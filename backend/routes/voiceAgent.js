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
3. **Outfit Builder** — Build complete outfits (top, bottom, shoes, and optional accessories like necklaces, earrings, bracelets). Use build_outfit for full looks.
4. **Style Advice** — Give honest, encouraging fashion tips.
5. **Save to Favorites** — Save the current try-on result to the user's favorites. Use save_favorite when they say "save this", "add to favorites", etc.
6. **Save Video** — Save a generated animation/video. Use save_video when they say "save this video", "keep this animation", etc.
7. **Animate Try-On** — Generate a short video animation from the current try-on result. Use animate_tryon when they say "animate this", "make a video", "show me moving", etc.
8. **Download** — Download the current try-on image or video to the user's computer. Use download when they say "download this", "save to my computer", etc.
9. **Share/Send** — Share or send the current try-on result. Use send_tryon when they say "send this", "share this", etc.

IMPORTANT: Always respond in {{LANGUAGE}}. All your speech output must be in {{LANGUAGE}}.
However, ALL tool call arguments (queries, titles, descriptions) MUST always be in English, regardless of the conversation language. This is critical because searches and product lookups are performed on Amazon.com which requires English. For example, if the user says "busca un vestido rojo" in Spanish, you should call smart_search with query "red dress", NOT "vestido rojo". Always translate tool arguments to English.

Search results and outfit builder items are numbered (1-based). When the user refers to an item by number (e.g., "try on number 3", "I like the second one"), use select_search_item (for smart search) or select_outfit_items (for outfit builder).

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
IMPORTANT: Always use the user's sex to filter searches automatically. If the user is female, search for "women's" items. If male, search for "men's" items. NEVER show items for the wrong gender. NEVER ask the user their sex or size — you already know from their profile. When relevant, include their clothing size or shoe size in search queries or recommendations.

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
      "Build a complete outfit by searching for a top, bottom, and optionally shoes and accessories. Use when the user wants a full outfit or coordinated look.",
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
      "Select specific items by their numbers in the outfit builder and trigger a try-on. Use when the user refers to outfit items by number, e.g. 'top number 2, bottom number 1, shoes number 3'. At least one category must be specified.",
    inputSchema: {
      json: JSON.stringify({
        type: "object",
        properties: {
          top_number: {
            type: "integer",
            description:
              "The number of the top/upper wear item to select (1-based)",
          },
          bottom_number: {
            type: "integer",
            description:
              "The number of the bottom/lower wear item to select (1-based)",
          },
          shoes_number: {
            type: "integer",
            description:
              "The number of the shoes item to select (1-based)",
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
      const ack = await emitAndWaitForAck(socket, {
        action: "build_outfit",
        top: args.top,
        bottom: args.bottom,
        shoes: args.shoes || null,
        necklace: args.necklace || null,
        earrings: args.earrings || null,
        bracelets: args.bracelets || null,
      });
      const parts = [];
      if (args.top) parts.push(`top="${args.top}"`);
      if (args.bottom) parts.push(`bottom="${args.bottom}"`);
      if (args.shoes) parts.push(`shoes="${args.shoes}"`);
      if (args.necklace) parts.push(`necklace="${args.necklace}"`);
      if (args.earrings) parts.push(`earrings="${args.earrings}"`);
      if (args.bracelets) parts.push(`bracelets="${args.bracelets}"`);
      return {
        status: "success",
        message: `Opening the Outfit Builder with: ${parts.join(", ")}. The wardrobe will appear in a new tab.`,
        acknowledged: !!ack.acknowledged,
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
      console.log("[VoiceAgent] animate_tryon — emitting toolAction to client");
      const ack = await emitAndWaitForAck(socket, { action: "animate_tryon" });
      console.log("[VoiceAgent] animate_tryon — ack received:", JSON.stringify(ack));
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
        ? [...(outfitResults.tops || []), ...(outfitResults.bottoms || []), ...(outfitResults.shoes || [])]
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
      const ack = await emitAndWaitForAck(socket, {
        action: "select_outfit_items",
        topNumber: args.top_number || null,
        bottomNumber: args.bottom_number || null,
        shoesNumber: args.shoes_number || null,
      });
      const parts = [];
      if (args.top_number) parts.push(`top #${args.top_number}`);
      if (args.bottom_number) parts.push(`bottom #${args.bottom_number}`);
      if (args.shoes_number) parts.push(`shoes #${args.shoes_number}`);
      return {
        status: "success",
        message: `Selecting ${parts.join(", ")} in the outfit builder and trying on.`,
        acknowledged: !!ack.acknowledged,
      };
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
          sex: config?.sex || null,
          clothesSize: config?.clothesSize || null,
          shoesSize: config?.shoesSize || null,
        };
        socket._voiceSearchResults = [];
        socket._voiceOutfitResults = null;

        // Build user profile context
        const profileParts = [];
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
        const count = (data.tops?.length || 0) + (data.bottoms?.length || 0) + (data.shoes?.length || 0);
        console.log(`[VoiceAgent] Cached ${count} outfit items for recommendations`);
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
