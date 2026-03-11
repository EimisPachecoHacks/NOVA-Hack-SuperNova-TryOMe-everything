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
// System prompts — two short focused prompts for each agent mode
// Nova Sonic 2 has strict token limits — NEVER merge these into one prompt
// ---------------------------------------------------------------------------
const STYLIST_PROMPT = `You are Stella, a warm and stylish AI personal stylist. Keep responses to 1-2 short sentences. Speak naturally and use the user's name.

Always respond in {{LANGUAGE}}. Tool arguments must always be in English.

USER PROFILE: {{USER_PROFILE}}
Use the user's sex to filter searches automatically. Never ask for sex or size.

When a tool is working, say something brief like "On it!" and stop talking. After calling a tool, wait silently for the user to react. Never describe results you cannot see.

When the user asks "which one should I try?" or "what do you recommend?", use recommend_items. Include product_number when calling try_on. Use select_search_item when the user picks an item by number.

Only call a tool when the user explicitly asks. Never call tools on your own initiative.`;

const OUTFIT_BUILDER_PROMPT = `You are Stella, a warm and stylish AI personal stylist helping build an outfit. Keep responses to 1-2 short sentences. Speak naturally and use the user's name.

Always respond in {{LANGUAGE}}. Tool arguments must always be in English.

USER PROFILE: {{USER_PROFILE}}
Use the user's sex to filter searches automatically. Never ask for sex or size.

FLOW:
1. Say "I recommend..." and describe all 6 items (top, bottom, shoes, necklace, earrings, bracelets) with specific searchable descriptions (color + material + style). Then ask "Would you like to go with this selection or make any changes?"
2. When user confirms, say "generating your outfit now" and call build_outfit with all 6 items. Then STOP talking and wait silently.
3. Do NOT say "your look is ready" or "outfit is ready" until AFTER the user speaks again. The wardrobe needs time to load.
4. When user asks which items look best, call recommend_items. Then select each with select_outfit_items (one call per category). Ask "Would you like to see how these look on you?"
5. When user confirms try-on, call outfit_tryon. Wait silently.

select_outfit_items: one category + one number per call. Categories: top, bottom, shoes, necklace, earrings, bracelets.

After calling any tool, STOP talking and wait silently for the user.

{{CONTEXT_SUMMARY}}`;

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
// Tool definitions — shared objects, partitioned into agent-specific arrays
// ---------------------------------------------------------------------------
const TOOL_DEFS = {
  smart_search: {
    name: "smart_search",
    description: "Search Amazon for clothing items. Use when the user describes what they want.",
    inputSchema: { json: JSON.stringify({ type: "object", properties: { query: { type: "string", description: "Search query for clothing items on Amazon" } }, required: ["query"] }) },
  },
  try_on: {
    name: "try_on",
    description: "Virtual try-on for a garment. Use when the user wants to try something on.",
    inputSchema: { json: JSON.stringify({ type: "object", properties: { product_url: { type: "string", description: "Amazon product URL" }, product_title: { type: "string", description: "Product title" }, product_number: { type: "integer", description: "Item number from search results (1-based)" } }, required: ["product_title"] }) },
  },
  select_search_item: {
    name: "select_search_item",
    description: "Try on a specific item from search results by number.",
    inputSchema: { json: JSON.stringify({ type: "object", properties: { number: { type: "integer", description: "Item number (1-based)" } }, required: ["number"] }) },
  },
  add_to_cart: {
    name: "add_to_cart",
    description: "Add a product to the Amazon shopping cart.",
    inputSchema: { json: JSON.stringify({ type: "object", properties: { product_url: { type: "string", description: "Amazon product URL" }, product_title: { type: "string", description: "Product title" } }, required: ["product_url"] }) },
  },
  save_favorite: {
    name: "save_favorite",
    description: "Save the current try-on result to favorites.",
    inputSchema: { json: JSON.stringify({ type: "object", properties: {}, required: [] }) },
  },
  save_video: {
    name: "save_video",
    description: "Save the current animation/video.",
    inputSchema: { json: JSON.stringify({ type: "object", properties: {}, required: [] }) },
  },
  outfit_tryon: {
    name: "outfit_tryon",
    description: "Trigger the virtual try-on for the outfit builder wardrobe. PREREQUISITES: (1) confirm_outfit must have been called first to open the wardrobe, (2) items must have been selected via select_outfit_items, (3) user must explicitly confirm they want to try on. NEVER call this right after build_outfit — the wardrobe must be open with items selected first.",
    inputSchema: { json: JSON.stringify({ type: "object", properties: {}, required: [] }) },
  },
  animate_tryon: {
    name: "animate_tryon",
    description: "Generate a video animation from the try-on result. Only when user asks for animation.",
    inputSchema: { json: JSON.stringify({ type: "object", properties: {}, required: [] }) },
  },
  download: {
    name: "download",
    description: "Download the try-on image or video to the user's computer.",
    inputSchema: { json: JSON.stringify({ type: "object", properties: { type: { type: "string", enum: ["image", "video"], description: "image or video" } }, required: [] }) },
  },
  send_tryon: {
    name: "send_tryon",
    description: "Share or send the current try-on result.",
    inputSchema: { json: JSON.stringify({ type: "object", properties: {}, required: [] }) },
  },
  recommend_items: {
    name: "recommend_items",
    description: "Visually analyze items against the user's photo for personalized recommendations. Only when user asks.",
    inputSchema: { json: JSON.stringify({ type: "object", properties: {}, required: [] }) },
  },
  build_outfit: {
    name: "build_outfit",
    description: "Build a complete outfit with top, bottom, shoes, necklace, earrings, bracelets.",
    inputSchema: { json: JSON.stringify({ type: "object", properties: { top: { type: "string", description: "Top description" }, bottom: { type: "string", description: "Bottom description" }, shoes: { type: "string", description: "Shoes description" }, necklace: { type: "string", description: "Necklace description" }, earrings: { type: "string", description: "Earrings description" }, bracelets: { type: "string", description: "Bracelets description" } }, required: [] }) },
  },
  select_outfit_items: {
    name: "select_outfit_items",
    description: "Select ONE item by category and number in the outfit builder. Call once per item.",
    inputSchema: { json: JSON.stringify({ type: "object", properties: { category: { type: "string", enum: ["top", "bottom", "shoes", "necklace", "earrings", "bracelets"], description: "Outfit category" }, number: { type: "integer", description: "Item number (1-based)" } }, required: ["category", "number"] }) },
  },
  confirm_outfit: {
    name: "confirm_outfit",
    description: "Execute the pending outfit. Call only after user confirms.",
    inputSchema: { json: JSON.stringify({ type: "object", properties: { skip_missing: { type: "boolean", description: "True only if user explicitly declined missing categories" } }, required: [] }) },
  },
};

// Stylist agent tools (search, try-on, actions)
const STYLIST_TOOLS = [
  TOOL_DEFS.smart_search, TOOL_DEFS.try_on, TOOL_DEFS.select_search_item,
  TOOL_DEFS.add_to_cart, TOOL_DEFS.save_favorite, TOOL_DEFS.save_video,
  TOOL_DEFS.animate_tryon, TOOL_DEFS.download, TOOL_DEFS.send_tryon,
  TOOL_DEFS.recommend_items,
];

// Outfit builder agent tools (outfit flow + shared actions)
const OUTFIT_BUILDER_TOOLS = [
  TOOL_DEFS.build_outfit, TOOL_DEFS.confirm_outfit,
  TOOL_DEFS.select_outfit_items, TOOL_DEFS.recommend_items,
  TOOL_DEFS.outfit_tryon, TOOL_DEFS.save_favorite, TOOL_DEFS.save_video,
  TOOL_DEFS.animate_tryon, TOOL_DEFS.download, TOOL_DEFS.send_tryon,
];

// ---------------------------------------------------------------------------
// Intent detection — determines which agent should handle the user's request
// ---------------------------------------------------------------------------
const OUTFIT_KEYWORDS = ["outfit", "complete look", "full look", "put together", "build me", "whole outfit", "coordinate", "ensemble", "look completo", "arma un", "conjunto"];
const CATEGORY_KEYWORDS = {
  top: ["top", "shirt", "blouse", "t-shirt", "tee", "sweater", "hoodie", "jacket", "coat", "camisa", "blusa", "suéter", "chaqueta"],
  bottom: ["pants", "jeans", "skirt", "shorts", "trousers", "leggings", "pantalón", "falda", "pantalones"],
  shoes: ["shoes", "sneakers", "boots", "heels", "sandals", "loafers", "zapatos", "zapatillas", "botas", "tacones", "sandalias"],
  necklace: ["necklace", "chain", "collar"],
  earrings: ["earrings", "aretes", "pendientes"],
  bracelets: ["bracelet", "bracelets", "bangle", "pulsera", "pulseras"],
};

function detectOutfitIntent(transcript) {
  const text = (transcript || "").toLowerCase();

  // Check explicit outfit keywords
  for (const kw of OUTFIT_KEYWORDS) {
    if (text.includes(kw)) return "outfit_builder";
  }

  // Check if 3+ distinct clothing categories mentioned
  let categoryCount = 0;
  for (const [, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) categoryCount++;
  }
  if (categoryCount >= 3) return "outfit_builder";

  return null;
}

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
      // Deduplicate: reject if same/similar query was just searched within 60 seconds
      const now = Date.now();
      const lastSearch = socket._lastSmartSearch || { query: "", time: 0 };
      const queryNorm = (args.query || "").toLowerCase().trim();
      if (queryNorm === lastSearch.query && now - lastSearch.time < 60000) {
        console.log(`[VoiceAgent] Skipping duplicate smart_search: "${args.query}" (${now - lastSearch.time}ms ago)`);
        return {
          status: "already_done",
          message: `Search results for "${args.query}" are already displayed. Do NOT search again. Tell the user to look at the results and ask which item they want to try on.`,
        };
      }
      socket._lastSmartSearch = { query: queryNorm, time: now };

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
        message: `Search started for "${args.query}". Results are loading. Do NOT say anything else about the search — you already acknowledged it. Do NOT list, describe, or name any products. Do NOT call smart_search again. Stay silent and wait for the user to speak.`,
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
          status: "in_progress",
          message: `Try-on for item #${resolvedNumber} is NOW GENERATING — it is NOT finished yet. Tell the user "it's generating, one moment" and STOP talking. Do NOT say it is ready. Do NOT say it looks great. Do NOT describe the outfit. The image is NOT visible yet — WAIT silently for the user to speak first.`,
          acknowledged: !!ack.acknowledged,
        };
      }

      // No cached results — reject instead of opening a raw URL
      console.log(`[VoiceAgent] try_on REJECTED — no cached search results to match against. Title: "${resolvedTitle}"`);
      return {
        status: "error",
        message: `Could not find "${resolvedTitle}" in the current search results. Please search for this item first using smart_search, then try again.`,
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

      // All 6 categories filled in one call → user already confirmed, auto-execute
      if (missing.length === 0) {
        console.log(`[VoiceAgent] build_outfit: all 6 categories filled — auto-executing (opening wardrobe)`);
        socket._pendingOutfitAction = null;
        socket._wardrobeOpen = true;
        socket._awaitingOutfitConfirmation = false;
        const ack = await emitAndWaitForAck(socket, {
          action: "build_outfit",
          top: pending.args.top,
          bottom: pending.args.bottom,
          shoes: pending.args.shoes,
          necklace: pending.args.necklace,
          earrings: pending.args.earrings,
          bracelets: pending.args.bracelets,
        });
        return {
          status: "success",
          message: `Opening the Outfit Builder with: ${parts.join(", ")}. The wardrobe is searching Amazon and will display NUMBERED items in each category. Wait silently for items to load. When the user asks which items look best, call recommend_items, then select each with select_outfit_items.`,
          acknowledged: !!ack.acknowledged,
        };
      }

      const missingMsg = ` Still missing: ${missing.join(", ")}. Ask the user about these categories, especially accessories (necklace, earrings, bracelets).`;

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
      // Deduplicate: reject if save_video was just called within 60 seconds
      const saveNow = Date.now();
      const lastSave = socket._lastSaveVideo || 0;
      if (saveNow - lastSave < 60000) {
        console.log(`[VoiceAgent] Skipping duplicate save_video (${saveNow - lastSave}ms ago)`);
        return {
          status: "already_done",
          message: "The video has already been saved. Do NOT save again. Tell the user the video is saved.",
        };
      }
      socket._lastSaveVideo = saveNow;
      const ack = await emitAndWaitForAck(socket, { action: "save_video" });
      return {
        status: "success",
        message: "Saving the video to your collection.",
        acknowledged: !!ack.acknowledged,
      };
    }

    case "outfit_tryon": {
      // Code-level guard: only allow if the wardrobe is open (confirm_outfit was called)
      if (!socket._wardrobeOpen) {
        console.log(`[VoiceAgent] outfit_tryon BLOCKED — wardrobe is not open yet. Must call confirm_outfit first.`);
        return {
          status: "error",
          message: "The wardrobe is not open yet. You must call confirm_outfit first to open the Outfit Builder, wait for items to load, then let the user select items with select_outfit_items. Only AFTER items are selected can you call outfit_tryon.",
        };
      }
      console.log(`[VoiceAgent] outfit_tryon — triggering virtual try-on in wardrobe`);
      const ack = await emitAndWaitForAck(socket, { action: "outfit_tryon" });
      return {
        status: "in_progress",
        message: "The outfit try-on is NOW GENERATING — it is NOT finished yet. Tell the user it's generating and STOP talking. Do NOT say it is ready. Do NOT describe the result. WAIT silently for the user to speak first.",
        acknowledged: !!ack.acknowledged,
      };
    }

    case "animate_tryon": {
      // Code-level guard: only allow if user's last transcript contains animation keywords
      const ANIM_KEYWORDS = ["animate", "animation", "video", "move", "moving", "dance", "dancing", "twirl", "walk", "runway", "anima", "animación", "vídeo", "muévete", "baila"];
      const lastTranscript = socket._lastUserTranscript || "";
      const hasAnimKeyword = ANIM_KEYWORDS.some((kw) => lastTranscript.includes(kw));
      if (!hasAnimKeyword) {
        console.log(`[VoiceAgent] animate_tryon BLOCKED — user did not request animation. Last transcript: "${lastTranscript}"`);
        return {
          status: "error",
          message: "The user did not ask for an animation. Do NOT generate animations unless the user explicitly says 'animate this', 'make a video', 'show me moving', or similar. Just respond naturally to what the user said.",
        };
      }

      const animTraceId = 'anim_' + Date.now();
      console.log(`\x1b[33m[ANIMATE TRACE ${animTraceId}] Step 0/4: Backend emitting toolAction { action: "animate_tryon" } to popup via Socket.IO\x1b[0m`);
      const ack = await emitAndWaitForAck(socket, { action: "animate_tryon" });
      console.log(`\x1b[33m[ANIMATE TRACE ${animTraceId}] Ack from popup: ${JSON.stringify(ack)} (acknowledged=${!!ack.acknowledged}, timedOut=${!ack.acknowledged})\x1b[0m`);
      return {
        status: "in_progress",
        message: "Animation is NOW GENERATING — it is NOT finished yet. Tell the user the animation is generating and STOP talking. Do NOT say it is ready. Do NOT say it looks amazing. The video is NOT visible yet — WAIT silently for the user to speak first.",
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
      const isOutfitMode = !!outfitResults;

      if (!userId) {
        return { status: "error", message: "User not authenticated. Cannot access photos." };
      }

      // For outfit builder: keep items grouped by category
      // For smart search: flat list
      let items;
      if (isOutfitMode) {
        items = [...(outfitResults.tops || []), ...(outfitResults.bottoms || []), ...(outfitResults.shoes || []), ...(outfitResults.necklaces || []), ...(outfitResults.earrings || []), ...(outfitResults.bracelets || [])];
      } else {
        items = searchResults;
      }

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

        if (isOutfitMode) {
          // OUTFIT MODE: recommend a combination of items (one per category)
          const categoryData = {};
          const categories = [
            { key: "tops", label: "top", items: outfitResults.tops || [] },
            { key: "bottoms", label: "bottom", items: outfitResults.bottoms || [] },
            { key: "shoes", label: "shoes", items: outfitResults.shoes || [] },
            { key: "necklaces", label: "necklace", items: outfitResults.necklaces || [] },
            { key: "earrings", label: "earrings", items: outfitResults.earrings || [] },
            { key: "bracelets", label: "bracelets", items: outfitResults.bracelets || [] },
          ];
          for (const cat of categories) {
            if (cat.items.length > 0) {
              categoryData[cat.label] = cat.items.slice(0, 10).map((item) => ({
                number: item.number,
                title: item.title,
                price: item.price || "",
              }));
            }
          }

          console.log(`[VoiceAgent] Outfit recommendation: ${Object.keys(categoryData).length} categories, screenshot: ${!!screenshotBase64}`);
          const outfitRec = await recommendItems(userPhotoBase64, null, userProfile, screenshotBase64, categoryData);
          console.log(`[VoiceAgent] Outfit recommendation results:`, JSON.stringify(outfitRec));

          return {
            status: "success",
            recommendations: outfitRec,
            message: `Analyzed outfit items across ${Object.keys(categoryData).length} categories against the user's photo. Here is the recommended combination with the best item number for each category. Use select_outfit_items to select each recommended item by its category and number.`,
          };
        } else {
          // SMART SEARCH MODE: rank items best to worst
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
        }
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
        message: `Selected ${cat} #${num} in the outfit builder. The item is now highlighted in the wardrobe. Once all items are selected, ask the user "Would you like to see how these items look on you?" and wait for their response. When they confirm, call outfit_tryon. Do NOT assume try-on happens automatically — you must call outfit_tryon explicitly.`,
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
        socket._wardrobeOpen = true; // Wardrobe is now open — outfit_tryon allowed
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
          message: `Opening the Outfit Builder with: ${parts.join(", ")}. The wardrobe is searching Amazon and will display NUMBERED items in each category. Once items load, the user can say "top number 3" or "necklace number 2" to select. Use select_outfit_items with category and number. The outfit builder handles all searching — just wait for the user to pick items.`,
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
    let currentAgent = "stylist"; // "stylist" or "outfit_builder"
    let switchInProgress = false;
    let switchDebounceTimer = null;

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

    /**
     * Build a localized prompt for the given agent type using stored socket config.
     */
    function buildPrompt(agentType, contextSummary) {
      const langName = socket._voiceLangName || "English";
      const profileStr = socket._voiceProfileStr || "No profile information available";
      const basePrompt = agentType === "outfit_builder" ? OUTFIT_BUILDER_PROMPT : STYLIST_PROMPT;
      let prompt = basePrompt
        .replaceAll("{{LANGUAGE}}", langName)
        .replaceAll("{{USER_PROFILE}}", profileStr);
      if (agentType === "outfit_builder") {
        prompt = prompt.replaceAll("{{CONTEXT_SUMMARY}}", contextSummary || "");
      }
      return prompt;
    }

    /**
     * Wire up all session callbacks (shared by both agents).
     */
    function wireSessionCallbacks() {
      session.onAudioOutput = (base64Audio) => {
        socket.emit("audioOutput", base64Audio);
      };

      session.onTextOutput = (text, role) => {
        socket.emit("textOutput", { text, role });
        if (role === "USER" || role === "user") {
          socket._lastUserTranscript = (text || "").toLowerCase().trim();

          // Intent detection — switch agents if needed
          // Debounce: wait 2s after last utterance with outfit intent before switching,
          // so partial sentences like "find a good outfit for..." don't kill the session mid-speech
          if (!switchInProgress) {
            const intent = detectOutfitIntent(text);
            if (intent && intent !== currentAgent) {
              const summary = intent === "outfit_builder"
                ? "The user was browsing clothes and now wants to build a complete outfit."
                : "The user finished with the outfit builder and wants to browse individual items.";
              if (switchDebounceTimer) clearTimeout(switchDebounceTimer);
              console.log(`[VoiceAgent] Intent detected: "${intent}" (current: "${currentAgent}") — debouncing 2s. Transcript: "${text}"`);
              switchDebounceTimer = setTimeout(() => {
                switchDebounceTimer = null;
                switchAgent(intent, summary);
              }, 2000);
            } else if (switchDebounceTimer && !intent) {
              // User said something without outfit intent — cancel pending switch
              clearTimeout(switchDebounceTimer);
              switchDebounceTimer = null;
              console.log(`[VoiceAgent] Switch cancelled — subsequent utterance had no outfit intent.`);
            }
          }
        }
        // Clear the outfit confirmation gate when user actually speaks
        if ((role === "USER" || role === "user") && socket._awaitingOutfitConfirmation) {
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
        console.log(`[VoiceAgent] [${currentAgent}] Tool use: ${toolName} (${toolUseId})`);
        socket.emit("toolStart", { toolName });

        const result = await executeTool(toolName, content, socket);
        console.log(`[VoiceAgent] [${currentAgent}] Tool result:`, result);

        if (session && session.active) {
          session.sendToolResult(toolUseId, result);
        }
        socket.emit("toolEnd", { toolName, result });
      };

      session.onError = async (err) => {
        console.error("[VoiceAgent] Session error:", err.message);
        socket.emit("error", { message: err.message });
        if (session) {
          try { await session.close(); } catch (_) {}
          session = null;
        }
      };
    }

    /**
     * Switch between stylist and outfit_builder agents.
     * Closes current session and opens a new one with different prompt/tools.
     */
    async function switchAgent(targetAgent, contextSummary) {
      if (targetAgent === currentAgent || switchInProgress) return;
      switchInProgress = true;

      try {
        console.log(`[VoiceAgent] Switching agent: ${currentAgent} → ${targetAgent}`);

        // Close current session
        if (session) {
          try { await session.close(); } catch (_) {}
          session = null;
        }

        // Select prompt and tools for target agent
        const tools = targetAgent === "outfit_builder" ? OUTFIT_BUILDER_TOOLS : STYLIST_TOOLS;
        const prompt = buildPrompt(targetAgent, contextSummary);
        const voiceId = socket._voiceId || "tiffany";

        session = new SonicSession(prompt, tools, voiceId);
        wireSessionCallbacks();
        await session.start();

        currentAgent = targetAgent;
        socket.emit("agentSwitched", { agent: targetAgent });
        console.log(`[VoiceAgent] Agent switched to ${targetAgent} for ${socket.id}`);
        resetIdleTimer();
      } catch (err) {
        console.error(`[VoiceAgent] Failed to switch agent:`, err.message);
        socket.emit("error", { message: "Failed to switch agent mode: " + err.message });
      } finally {
        switchInProgress = false;
      }
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

        socket._voiceId = voiceId;
        socket._voiceLangCode = langCode;
        socket._voiceLangName = langName;

        // Store user context on socket for recommend_items tool
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
        socket._wardrobeOpen = false;

        // Build user profile string and store on socket
        const profileParts = [];
        if (config?.firstName) profileParts.push(`Name: ${config.firstName}`);
        if (config?.sex) profileParts.push(`Sex: ${config.sex}`);
        if (config?.clothesSize) profileParts.push(`Clothing size: ${config.clothesSize}`);
        if (config?.shoesSize) profileParts.push(`Shoe size: ${config.shoesSize}`);
        socket._voiceProfileStr = profileParts.length > 0
          ? profileParts.join(", ")
          : "No profile information available";

        currentAgent = "stylist";
        const prompt = buildPrompt("stylist");
        session = new SonicSession(prompt, STYLIST_TOOLS, voiceId);
        wireSessionCallbacks();

        await session.start();
        console.log(`[VoiceAgent] Session started for ${socket.id}`);
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
