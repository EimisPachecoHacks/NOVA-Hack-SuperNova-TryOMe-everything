# SuperNova TryOnMe

**AI-Powered Virtual Try-On for Amazon Shopping**

A Chrome Extension that lets you see clothes on YOUR body before you buy. Browse any Amazon product page, click "Try It On", and see the garment on your own body in seconds — powered by Amazon Nova, Google Gemini, and Grok xAI.

> Built for the **AI for Bharat Hackathon 2025**

---

## Features

### 1. Product Page Try-On
Browse any Amazon product page. A **"Try It On"** button appears on the product image. Click it and see the garment on your body in seconds.
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
Virtual makeup application using AI inpainting. Try lipstick, eyeshadow, blush, foundation, eyeliner, and mascara in any color on your own face.

### 6. Favorites & Profiles
Full user account system with cloud storage. Save your best looks, browse your try-on history, and manage multiple AI-generated profile poses.

---

## Architecture

```
┌─────────────────────┐     ┌─────────────────────┐     ┌──────────────────────┐
│   Chrome Extension   │     │   Express Backend    │     │    AI Models          │
│   (Manifest V3)      │────>│   (Node.js)          │────>│                      │
│                      │     │                      │     │  Amazon Nova 2 Lite  │
│  • Content Script    │     │  /api/try-on         │     │  Amazon Nova Canvas  │
│  • Background Worker │     │  /api/try-on/outfit  │     │  Gemini 2.5 Flash    │
│  • Popup Side Panel  │     │  /api/analyze        │     │  Gemini 3 Pro Image  │
│  • Smart Search UI   │     │  /api/cosmetics      │     │  Grok xAI Video      │
│  • Outfit Builder UI │     │  /api/video          │     │  Amazon Nova Act     │
│                      │     │  /api/auth/*         │     │                      │
└─────────────────────┘     │  /api/profile        │     └──────────────────────┘
                             │  /api/favorites      │            │
                             │  /api/smart-search   │            │
                             └─────────────────────┘            │
                                      │                          │
                      ┌───────────────┼──────────────┐           │
                      │               │              │           │
                      v               v              v           v
               ┌──────────┐   ┌──────────┐   ┌──────────┐ ┌──────────┐
               │ Cognito   │   │    S3     │   │ DynamoDB │ │ Bedrock  │
               │ Auth/JWT  │   │  Photos   │   │ Profiles │ │ Runtime  │
               │           │   │  Videos   │   │ Favorites│ │          │
               └──────────┘   └──────────┘   └──────────┘ └──────────┘
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
| **Gemini 2.5 Flash Image** | Google | Single-garment virtual try-on, garment extraction, AI profile generation |
| **Gemini 3 Pro Image** | Google | Multi-garment outfit try-on (better identity preservation) |
| **Grok Imagine Video** | xAI (via fal.ai) | Image-to-video animation of try-on results |
| **Nova Act** | Amazon | AI browser agent for Smart Search and Outfit Builder product discovery |

### AWS Infrastructure

| Service | Usage |
|---------|-------|
| **Amazon Cognito** | User authentication, email verification, JWT tokens |
| **Amazon S3** | User photos, AI-generated poses, try-on results, videos |
| **Amazon DynamoDB** | User profiles, favorites (indexed by ASIN) |
| **Amazon Bedrock** | Unified API for Nova Lite, Nova Canvas |

### Application Stack

| Component | Technology |
|-----------|-----------|
| Frontend | Chrome Extension (Manifest V3) — content scripts, background service worker, popup |
| Backend | Node.js + Express |
| Image Processing | Sharp |
| Auth | JWT with Cognito token verification (jwks-rsa) |

---

## Prerequisites

- **Node.js 18+**
- **Google Chrome** browser
- **AWS Account** with:
  - Amazon Bedrock access (Nova 2 Lite, Nova Canvas enabled in us-east-1)
  - Amazon Cognito User Pool
  - S3 buckets for user data and videos
  - DynamoDB tables (`NovaTryOnMe_UserProfiles`, `NovaTryOnMe_Favorites`)
- **Google Gemini API key** (from Google AI Studio)
- **fal.ai API key** (for Grok video generation)
- **Nova Act API key** (for Smart Search / Outfit Builder)

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

1. Go to any Amazon clothing/shoes/cosmetics product page
2. A sparkle **"Try It On"** button appears on the product image
3. Click it — the button toggles to **"Try On: ON"** and the overlay opens
4. Wait ~10-15s for the AI pipeline to generate your try-on result
5. Click different color swatches on Amazon — try-on auto-refreshes
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
5. Select one item from each category
6. Click **Try On** to see the complete outfit on your body
7. Click **Save to Favorites** to keep the outfit

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/analyze` | Analyze product image (Nova 2 Lite classification) |
| POST | `/api/try-on` | Single-garment virtual try-on (5-step pipeline) |
| POST | `/api/try-on/outfit` | Multi-garment outfit try-on (single Gemini call) |
| POST | `/api/cosmetics` | Cosmetics try-on via inpainting |
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
| GET | `/api/favorites` | Get saved favorites |
| POST | `/api/favorites` | Save a favorite |
| DELETE | `/api/favorites/:asin` | Remove a favorite |

---

## Project Structure

```
NovaTryOnMe/
├── backend/
│   ├── server.js              # Express app entry point
│   ├── package.json           # Node.js dependencies
│   ├── .env                   # Environment variables (not committed)
│   ├── routes/
│   │   ├── tryOn.js           # Try-on endpoints (single + outfit)
│   │   ├── analyze.js         # Product analysis endpoint
│   │   ├── cosmetics.js       # Cosmetics try-on endpoint
│   │   ├── video.js           # Video generation endpoints
│   │   ├── auth.js            # Authentication endpoints
│   │   ├── profile.js         # User profile management
│   │   ├── favorites.js       # Favorites CRUD
│   │   └── smartSearch.js     # AI Smart Search endpoint
│   ├── services/
│   │   ├── gemini.js          # Gemini API (try-on, extraction, profiles)
│   │   ├── novaCanvas.js      # Nova Canvas (BG removal, inpainting)
│   │   ├── novaLite.js        # Nova 2 Lite (classification)
│   │   ├── grok.js            # Grok video generation (fal.ai)
│   │   ├── dynamodb.js        # DynamoDB operations
│   │   └── cognito.js         # Cognito auth operations
│   ├── middleware/
│   │   └── auth.js            # JWT verification middleware
│   └── python-services/
│       └── nova_act_search.py # Nova Act browser agent
├── extension/
│   ├── manifest.json          # Chrome Extension manifest (MV3)
│   ├── background.js          # Service worker (auth, message routing)
│   ├── content.js             # Content script (Amazon page integration)
│   ├── popup/
│   │   ├── popup.html         # Side panel UI
│   │   ├── popup.js           # Side panel logic
│   │   └── popup.css          # Side panel styles
│   ├── smart-search/
│   │   ├── results.html       # Smart Search results page
│   │   ├── results.js         # Smart Search logic
│   │   └── results.css        # Smart Search styles
│   ├── outfit-builder/
│   │   ├── wardrobe.html      # Outfit Builder wardrobe UI
│   │   ├── wardrobe.js        # Outfit Builder logic
│   │   └── wardrobe.css       # Outfit Builder styles
│   ├── styles/
│   │   └── content.css        # Content script overlay styles
│   ├── utils/
│   │   ├── api-client.js      # API client (message passing)
│   │   ├── amazon-scraper.js  # Amazon page scraping utilities
│   │   └── image-utils.js     # Image loading and conversion
│   └── icons/                 # Extension icons
├── presentation.html          # Hackathon presentation slides
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
