# SuperNova TryOnMe

**AI-Powered Virtual Try-On for Online Shopping**

A Chrome Extension that lets you see clothes on YOUR body before you buy. Browse product pages on Amazon, Shein, Temu, or Google Shopping, click "Try It On", and see the garment on your own body in seconds — powered by Amazon Nova, Google Gemini, and Grok xAI.

> Built for the **AI for Bharat Hackathon 2025**

---

## Features

### 1. Product Page Try-On (Multi-Retailer)
Browse product pages on **Amazon, Shein, Temu, or Google Shopping**. A **"Try It On"** button appears on the product image. Click it and see the garment on your body in seconds.
- Works on 4 major retailers with per-site scrapers
- Auto-detects product type (tops, bottoms, dresses, footwear, cosmetics)
- Smart outfit conflict resolution (e.g., trying a top on someone wearing a dress)
- Auto-refresh on color/variation swatch changes
- Save to favorites and animate results into video
- Full body and half body framing options
- 3 selectable AI-generated poses

### 2. AI Smart Search
Type what you want in natural language: *"black dresses for women"*. An AI agent browses Amazon, applies quality filters (4+ stars), and returns 20+ curated products — each with a "Try On" button.
- Powered by **Amazon Nova Act** (AI browser agent)
- Natural language queries instead of keyword search
- Product grid with prices, ratings, and direct Amazon links

### 3. Outfit Builder
Build a complete outfit by describing a **top, bottom, and shoes** separately. AI searches Amazon for each category in parallel, presents a virtual wardrobe with hangers, and lets you mix & match. Try the full outfit together in one shot.
- 3 parallel product searches via Nova Act
- Background removal on all product images
- Visual wardrobe with hanger display
- Single-call multi-garment try-on with identity preservation

### 4. Video Animation
Transform any try-on result into a 6-second video with natural model-like movement, fabric flow, and subtle poses.
- Powered by **Grok Imagine Video** (xAI via fal.ai)
- 720p portrait format (9:16)
- Save to cloud or download locally

### 5. Cosmetics Try-On
Virtual makeup application using AI. Try lipstick, eyeshadow, blush, foundation, eyeliner, and mascara in any color on your own face.
- Personalized color recommendations based on skin tone and undertone analysis
- Product image color matching for accurate shade reproduction

### 6. Stella Voice Agent
Hands-free AI shopping assistant powered by **Amazon Nova Sonic**.
- Real-time bidirectional voice streaming via WebSocket
- Voice commands: search, try on, build outfits, add to cart
- Multiple voice options (Tiffany, Matthew, Amy)
- Tool-calling architecture for seamless AI actions mid-conversation

### 7. Favorites & Smart Cart
Full user account system with cloud storage. Save your best looks with retailer badges (Amazon, Shein, Temu, Google Shopping).
- Select favorites with checkboxes and add them to your Amazon cart in one click
- **Nova Act** runs headlessly in the background to automate Add to Cart
- Dual-server architecture: EC2 for APIs, local Python server for cart operations (requires user's Amazon login session)
- Outfit cards group multi-item favorites with total price display

---

## Architecture

```
┌─────────────────────┐     ┌──────────────────────────┐     ┌──────────────────────┐
│   Chrome Extension   │     │   EC2 Backend (Node.js)   │     │    AI Models          │
│   (Manifest V3)      │────>│   Express + Socket.IO     │────>│                      │
│                      │     │                            │     │  Amazon Nova 2 Lite  │
│  • Content Scripts   │     │  /api/try-on              │     │  Amazon Nova Canvas  │
│    (Amazon, Shein,   │     │  /api/try-on/outfit       │     │  Amazon Nova Sonic   │
│     Temu, Google)    │     │  /api/analyze             │     │  Gemini 2.5 Flash    │
│  • Background Worker │     │  /api/cosmetics           │     │  Gemini 3 Pro Image  │
│  • Popup Side Panel  │     │  /api/video               │     │  Grok xAI Video      │
│  • Smart Search UI   │     │  /api/smart-search        │     │  Amazon Nova Act     │
│  • Outfit Builder UI │     │  /api/auth/* /favorites   │     │                      │
│  • Stella Voice UI   │     │  Voice Agent (Socket.IO)  │     └──────────────────────┘
│                      │     └──────────────────────────┘            │
└──────┬──────────────┘              │                               │
       │                  ┌──────────┼───────────────┐              │
       │                  │          │               │              │
       │                  v          v               v              v
       │           ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
       │           │ Cognito   │ │    S3     │ │ DynamoDB │ │ Bedrock  │
       │           │ Auth/JWT  │ │  Photos   │ │ Profiles │ │ Runtime  │
       │           │           │ │  Videos   │ │ Favorites│ │          │
       │           └──────────┘ └──────────┘ └──────────┘ └──────────┘
       │
       │  localhost:7860
       v
┌─────────────────────┐
│  Local Cart Server   │
│  (Python + Nova Act) │
│                      │
│  Headless browser    │
│  Uses user's Amazon  │
│  login session       │
│  POST /add-to-cart   │
└─────────────────────┘
```

### Smart Try-On Pipeline (5 Steps)

Each single-garment try-on goes through a 5-step AI orchestration:

| Step | Name | Model | What It Does |
|------|------|-------|--------------|
| 1 | Product Analysis | Nova 2 Lite | Classifies garment type, color, category |
| 2 | Garment Preprocessing | Gemini / Nova Canvas | Detects model in image, extracts clean garment |
| 3 | Outfit Classification | Nova 2 Lite | Classifies what the user is currently wearing |
| 4 | Conflict Resolution | buildSmartPrompt | Builds context-aware prompt based on garment + outfit combination |
| 5 | Virtual Try-On | Gemini 2.5 Flash | Generates photorealistic result preserving user identity |

### Outfit Builder Pipeline

The outfit builder uses a single Gemini 3 Pro Image call with all garments + face reference photos for identity preservation:

1. User selects top, bottom, and shoes from the wardrobe
2. All garment images go through preprocessing (person detection + extraction)
3. Face reference photos are fetched from S3 as identity anchors
4. Single API call to Gemini 3 Pro with garments first, identity photos last, low temperature (0.4)

---

## Technology Stack

### AI Models

| Model | Provider | Role |
|-------|----------|------|
| **Nova 2 Lite** | Amazon Bedrock | Fast product classification, outfit detection, person-in-image detection |
| **Nova Canvas** | Amazon Bedrock | Background removal, cosmetics inpainting |
| **Nova Sonic** | Amazon Bedrock | Real-time bidirectional voice streaming for Stella voice agent |
| **Nova Act** | Amazon | AI browser agent for Smart Search, Outfit Builder, and Add to Cart automation |
| **Gemini 2.5 Flash Image** | Google | Single-garment virtual try-on, garment extraction, AI profile generation, cosmetics with color recommendations |
| **Gemini 3 Pro Image** | Google | Multi-garment outfit try-on (better identity preservation) |
| **Grok Imagine Video** | xAI (via fal.ai) | Image-to-video animation of try-on results |

### AWS Infrastructure

| Service | Usage |
|---------|-------|
| **Amazon EC2** | Backend server (Node.js + Express + Socket.IO), managed with PM2 |
| **Amazon ElastiCache** | Redis for session caching and rate limiting |
| **Amazon Cognito** | User authentication, email verification, JWT tokens |
| **Amazon S3** | User photos, AI-generated poses, try-on results, videos |
| **Amazon DynamoDB** | User profiles, favorites with retailer tracking |
| **Amazon Bedrock** | Unified API for Nova Lite, Nova Canvas, Nova Sonic |

### Application Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Chrome Extension (Manifest V3) — multi-retailer content scripts, background service worker, side panel popup |
| Backend (EC2) | Node.js + Express + Socket.IO |
| Local Cart Server | Python + Nova Act (headless browser automation) |
| Voice Agent | Amazon Nova Sonic via WebSocket (bidirectional streaming) |
| Image Processing | Sharp |
| Auth | JWT with Cognito token verification (jwks-rsa) |

---

## Prerequisites

- **Node.js 18+**
- **Python 3.10+** with `nova-act` package (for Smart Cart feature)
- **Google Chrome** browser
- **AWS Account** with:
  - Amazon EC2 instance (backend deployment)
  - Amazon ElastiCache Redis (session caching)
  - Amazon Bedrock access (Nova 2 Lite, Nova Canvas, Nova Sonic enabled in us-east-1)
  - Amazon Cognito User Pool
  - S3 buckets for user data and videos
  - DynamoDB tables (`NovaTryOnMe_UserProfiles`, `NovaTryOnMe_Favorites`)
- **Google Gemini API key** (from Google AI Studio)
- **fal.ai API key** (for Grok video generation)
- **Nova Act API key** (for Smart Search / Outfit Builder / Smart Cart)

---

## Installation & Setup

### 1. Clone the Repository

```bash
git clone https://github.com/your-username/NovaTryOnMe.git
cd NovaTryOnMe
```

### 2. Install Backend Dependencies

```bash
cd backend
npm install
```

### 3. Configure Environment Variables

Create `backend/.env` with the following:

```env
# AWS Credentials
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

# S3 Buckets
S3_BUCKET=your-general-bucket
S3_USER_BUCKET=nova-tryonme-users

# Cognito
COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
COGNITO_CLIENT_ID=your_cognito_client_id
COGNITO_REGION=us-east-1

# AI Model Keys
GEMINI_API_KEY=your_gemini_api_key
FAL_KEY=your_fal_ai_key
NOVA_ACT_API_KEY=your_nova_act_key

# Provider Selection
TRYON_PROVIDER=gemini
VIDEO_PROVIDER=grok

# Server
PORT=3000
```

### 4. Start the Backend Server

```bash
# Development (with auto-reload)
npm run dev

# Production
npm start
```

The server will start on `http://localhost:3000`. Verify with:
```bash
curl http://localhost:3000/
# Should return: {"status":"ok","service":"SuperNova TryOnMe Backend",...}
```

### 5. Load the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `extension/` directory from this project
5. Pin the extension icon in the Chrome toolbar

### 6. First-Time Setup (User Account)

1. Click the SuperNova TryOnMe extension icon in the toolbar
2. **Create an account** — sign up with email and verify via the code sent to your inbox
3. **Upload 5 photos** — 3 full-body photos + 2 face close-ups
4. **Wait for AI profile generation** — Gemini generates 3 professional model poses of you (~30s)
5. You're ready! Navigate to any Amazon product page to start trying on

---

## How to Use

### Product Page Try-On

1. Go to any product page on **Amazon, Shein, Temu, or Google Shopping**
2. A sparkle **"Try It On"** button appears on the product image
3. Click it — the button toggles to **"Try On: ON"** and the overlay opens
4. Wait ~10-15s for the AI pipeline to generate your try-on result
5. Click different color swatches — try-on auto-refreshes
6. Click the result image to enlarge it in a lightbox
7. Use the side panel to switch between **Pose A/B/C** and **Full/Half body**
8. Click **Save to Favorites** to keep the look
9. Click **Animate** to generate a video of you wearing the outfit

### AI Smart Search

1. Click the extension icon → **Smart Search** tab
2. Type a natural language query (e.g., *"red summer dress for women"*)
3. An AI agent browses Amazon and returns curated products
4. Click **Try On** on any result to see it on your body
5. Click **Buy on Amazon** to go to the product page

### Outfit Builder

1. Click the extension icon → **Outfit Builder** tab
2. Describe your desired **top**, **bottom**, and **shoes** separately
3. Click **Build Outfit** — AI searches Amazon for each category in parallel
4. A virtual wardrobe appears with hangers and shoe rack
5. Select one item from each category — total price updates live
6. Click **Try On** to see the complete outfit on your body
7. Click **Buy on Amazon** to open all selected product pages
8. Click **Save to Favorites** to keep the outfit

### Stella Voice Agent

1. Click the extension icon → **Stella** tab
2. Click the microphone button to start a voice session
3. Speak naturally: *"Find me a red dress"*, *"Try this on me"*, *"Build me a party outfit"*
4. Stella responds with voice, executes AI tools, and shows results in real-time

### Smart Cart (Add to Shopping Cart)

1. Go to **My Favorites** in the side panel
2. Check the boxes next to items you want to buy
3. Click **"Add to Shopping Cart"** at the bottom
4. Nova Act runs headlessly in the background, adding each item to your Amazon cart
5. Success confirmation appears when done

> **Note:** The Smart Cart feature requires the local cart server running:
> ```bash
> cd backend/python-services && python3 cart_server.py
> ```
> This runs Nova Act on your machine using your local Chrome profile (Amazon login session).

---

## API Endpoints

**EC2 Backend (http://EC2_IP:3000)**

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/analyze` | Analyze product image (Nova 2 Lite classification) |
| POST | `/api/try-on` | Single-garment virtual try-on (5-step pipeline) |
| POST | `/api/try-on/outfit` | Multi-garment outfit try-on (single Gemini call) |
| POST | `/api/cosmetics` | Cosmetics try-on with personalized color recommendations |
| POST | `/api/video` | Start video generation (Grok) |
| GET | `/api/video/status` | Poll video generation status |
| POST | `/api/video/save` | Save generated video to S3 |
| POST | `/api/image/remove-bg` | Background removal (Nova Canvas) |
| POST | `/api/smart-search` | AI-powered product search (Nova Act) |
| POST | `/api/auth/signup` | User registration |
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/confirm` | Email verification |
| POST | `/api/auth/refresh` | Token refresh |
| GET | `/api/profile` | Get user profile |
| PUT | `/api/profile` | Update user profile |
| POST | `/api/profile/photos` | Upload user photo |
| GET | `/api/profile/photos/all` | Get all user photos |
| GET | `/api/favorites` | Get saved favorites (with retailer + presigned URLs) |
| POST | `/api/favorites` | Save a favorite (with retailer + productUrl) |
| DELETE | `/api/favorites/:asin` | Remove a favorite |
| WS | Socket.IO `/` | Stella voice agent (Nova Sonic bidirectional streaming) |

**Local Cart Server (http://localhost:7860)**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/add-to-cart` | Add products to Amazon cart via Nova Act (headless) |

---

## Project Structure

```
NovaTryOnMe/
├── backend/
│   ├── server.js              # Express + Socket.IO entry point
│   ├── package.json           # Node.js dependencies
│   ├── .env                   # Environment variables (not committed)
│   ├── routes/
│   │   ├── tryOn.js           # Try-on endpoints (single + outfit)
│   │   ├── analyze.js         # Product analysis endpoint
│   │   ├── cosmetics.js       # Cosmetics try-on with color recommendations
│   │   ├── video.js           # Video generation endpoints
│   │   ├── auth.js            # Authentication endpoints
│   │   ├── profile.js         # User profile management
│   │   ├── favorites.js       # Favorites CRUD (multi-retailer)
│   │   ├── smartSearch.js     # AI Smart Search endpoint
│   │   ├── addToCart.js       # Add to Cart endpoint (Nova Act)
│   │   └── voiceAgent.js      # Stella voice agent (Nova Sonic + Socket.IO)
│   ├── services/
│   │   ├── gemini.js          # Gemini API (try-on, extraction, profiles)
│   │   ├── novaCanvas.js      # Nova Canvas (BG removal, inpainting)
│   │   ├── novaLite.js        # Nova 2 Lite (classification)
│   │   ├── grok.js            # Grok video generation (fal.ai)
│   │   ├── dynamodb.js        # DynamoDB operations
│   │   ├── s3.js              # S3 operations (photos, presigned URLs)
│   │   └── cognito.js         # Cognito auth operations
│   ├── middleware/
│   │   └── auth.js            # JWT verification middleware
│   └── python-services/
│       ├── smart_search.py    # Nova Act browser agent (product search)
│       ├── add_to_cart.py     # Nova Act add to cart (subprocess)
│       └── cart_server.py     # Local HTTP server for Nova Act cart automation
├── extension/
│   ├── manifest.json          # Chrome Extension manifest (MV3, multi-site)
│   ├── background.js          # Service worker (auth, message routing)
│   ├── content.js             # Content script (Amazon page integration)
│   ├── content-gshopping.js   # Content script (Google Shopping)
│   ├── popup/
│   │   ├── popup.html         # Side panel UI
│   │   ├── popup.js           # Side panel logic (favorites, cart, voice)
│   │   └── popup.css          # Side panel styles
│   ├── smart-search/
│   │   ├── results.html       # Smart Search results page
│   │   ├── results.js         # Smart Search logic
│   │   └── results.css        # Smart Search styles
│   ├── outfit-builder/
│   │   ├── wardrobe.html      # Outfit Builder wardrobe UI
│   │   ├── wardrobe.js        # Outfit Builder logic (price totals, buy)
│   │   └── wardrobe.css       # Outfit Builder styles
│   ├── voice-agent/
│   │   └── socket.io.min.js   # Socket.IO client for Stella
│   ├── styles/
│   │   └── content.css        # Content script overlay styles
│   ├── utils/
│   │   ├── api-client.js      # API client (message passing)
│   │   ├── amazon-scraper.js  # Amazon page scraping
│   │   ├── shein-scraper.js   # Shein page scraping
│   │   ├── temu-scraper.js    # Temu page scraping
│   │   ├── google-shopping-scraper.js # Google Shopping scraping
│   │   └── image-utils.js     # Image loading and conversion
│   └── icons/                 # Extension icons
├── presentation.html          # Hackathon presentation slides (20 slides)
├── app-images/                # Screenshots and diagrams
└── README.md                  # This file
```

---

## Testing

### Verify Backend is Running
```bash
curl http://localhost:3000/
```

### Test Product Analysis
```bash
curl -X POST http://localhost:3000/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"imageBase64": "<base64-image>", "title": "Women T-Shirt", "breadcrumbs": "Clothing > Tops"}'
```

### Test Try-On (requires auth)
The try-on endpoints require a valid JWT token from Cognito. The Chrome extension handles this automatically through the background service worker.

### End-to-End Test
1. Start the backend: `cd backend && npm run dev`
2. Load the extension in Chrome
3. Sign up / sign in through the extension popup
4. Upload your 5 photos (3 body + 2 face)
5. Navigate to an Amazon clothing product page
6. Click "Try It On" and verify the result appears
7. Try switching color swatches — should auto-refresh
8. Click the result image to test the lightbox
9. Click "Animate" to test video generation
10. Open the Outfit Builder and build a complete outfit

---

## License

MIT
