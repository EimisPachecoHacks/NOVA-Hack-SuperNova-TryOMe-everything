# NovaTryOnMe - Virtual Try-On for Amazon Shopping

> Amazon Nova AI Hackathon Submission

A Chrome extension that lets you virtually try on clothing, footwear, and cosmetics while shopping on Amazon. Powered by Amazon Nova foundation models through Amazon Bedrock.

## Tech Stack

- **Amazon Nova Lite** - Product image analysis and classification (Converse API)
- **Amazon Nova Canvas** - Virtual clothing try-on via image generation and inpainting
- **Amazon Nova Reel** - Video generation for try-on previews
- **Amazon Bedrock** - Unified API for all Nova model interactions
- **Node.js / Express** - Backend API server
- **Chrome Extension (Manifest V3)** - Frontend browser integration
- **AWS S3** - Video output storage for Nova Reel

## Prerequisites

- Node.js 18+
- AWS account with Amazon Bedrock access (Nova models enabled)
- Chrome browser

## Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/NovaTryOnMe.git
   cd NovaTryOnMe
   ```

2. **Install backend dependencies**
   ```bash
   cd backend
   npm install
   ```

3. **Configure environment variables**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and fill in your AWS credentials and region.

4. **Start the backend server**
   ```bash
   npm run dev
   ```
   The server will start on port 3000 (or the port specified in `.env`).

5. **Load the Chrome extension**
   - Open Chrome and navigate to `chrome://extensions`
   - Enable **Developer mode** (toggle in the top-right corner)
   - Click **Load unpacked**
   - Select the `extension/` directory from this project

6. **Try it out**
   - Navigate to any Amazon product page (clothing, shoes, or cosmetics)
   - Click the NovaTryOnMe extension icon
   - Upload your photo and click "Try On"

## API Endpoints

| Method | Endpoint             | Description                              |
|--------|----------------------|------------------------------------------|
| POST   | `/api/analyze`       | Analyze product image with Nova Lite     |
| POST   | `/api/try-on`        | Virtual clothing try-on with Nova Canvas |
| POST   | `/api/cosmetics`     | Cosmetics try-on via inpainting          |
| POST   | `/api/video`         | Generate try-on video with Nova Reel     |
| POST   | `/api/image/remove-bg`| Remove background from user photo       |

## Nova Models Used

| Model | Role | Why |
|-------|------|-----|
| **Nova Lite** (`us.amazon.nova-lite-v1:0`) | Product classification | Analyzes product images to determine category, garment type, and style tips. Uses the Converse API for multimodal understanding. |
| **Nova Canvas** (`amazon.nova-canvas-v1:0`) | Virtual try-on | Generates try-on images using image conditioning. Handles clothing overlay and cosmetic inpainting. |
| **Nova Reel** (`amazon.nova-reel-v1:0`) | Video preview | Creates short video clips showing the try-on result from multiple angles. |

## Architecture

```
+-------------------+       +-------------------+       +-------------------+
|  Chrome Extension |       |   Express Server  |       |  Amazon Bedrock   |
|  (Manifest V3)    | ----> |   (Node.js API)   | ----> |                   |
|                   |       |                   |       |  Nova Lite        |
|  - Content Script |       |  /api/analyze     |       |  Nova Canvas      |
|  - Popup UI       |       |  /api/try-on      |       |  Nova Reel        |
|  - Side Panel     |       |  /api/cosmetics   |       |                   |
+-------------------+       |  /api/video       |       +-------------------+
                            +-------------------+              |
                                    |                          |
                                    v                          v
                            +-------------------+       +-------------------+
                            |  Shared Constants |       |     AWS S3        |
                            |  (shared/)        |       |  (Video Output)   |
                            +-------------------+       +-------------------+
```

## Screenshots

*Screenshots will be added after the demo is recorded.*

## License

MIT
