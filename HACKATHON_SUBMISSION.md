## Inspiration

We were frustrated by the gap between online shopping and the fitting room experience. Every time we bought clothes online, it was a gamble — would it actually look good on us? Returns are expensive, wasteful, and time-consuming. We wanted to bring the fitting room to the browser, powered by AI, and make it feel as natural as asking a friend "how does this look on me?" That's when we imagined Stella — a voice-powered AI stylist that doesn't just show you clothes, but actually dresses you in them, right on your screen.

## What it does

SuperNova TryOnMe is a Chrome extension that transforms online shopping into a virtual fitting room experience across Amazon, Shein, Temu, and Google Shopping. Users upload 5 photos of themselves, and our AI generates professional model poses. From there, they can:

- **Try on any garment** directly from product pages with one click — our 5-step AI pipeline handles garment extraction, outfit conflict resolution, and photorealistic try-on
- **Talk to Stella**, our real-time voice AI stylist powered by Amazon Nova Sonic — she searches products, builds outfits, triggers try-ons, and gives personalized style advice, all through natural conversation
- **Build complete outfits** with 6 categories (top, bottom, shoes, necklace, earrings, bracelets) using the Outfit Builder wardrobe — Stella orchestrates Nova Act to search Amazon and display numbered items the user selects by voice
- **Animate try-on results** into 6-second fashion videos using Grok Imagine Video
- **Add items to cart** through AI-powered browser automation via Nova Act
- **Save favorites** to the cloud with retailer tracking, outfit grouping, and price totals

## How we built it

The backend runs on Node.js/Express deployed on EC2 with PM2, using 7 AI models orchestrated together:

- **Amazon Nova Sonic** — Bidirectional HTTP/2 streaming for Stella's real-time voice with tool-calling mid-conversation
- **Amazon Nova Canvas** — Background removal and cosmetics inpainting
- **Amazon Nova 2 Lite** — Fast product classification and outfit detection
- **Amazon Nova Act** — Browser automation agent for smart search and add-to-cart
- **Google Gemini 2.5 Flash** — Single-garment virtual try-on with identity preservation
- **Google Gemini 3 Pro** — Multi-garment outfit try-on
- **Grok Imagine Video** — Try-on result animation

AWS services include Bedrock, S3, DynamoDB, Cognito, and ElastiCache (Redis). The Chrome extension (Manifest V3) injects try-on buttons into 4 retailers, manages auth tokens, routes voice commands, and renders the outfit builder wardrobe and smart search UIs. The full codebase is 14,500+ lines across the extension and backend.

## Challenges we ran into

The hardest challenge was making Stella reliable in the outfit builder flow. Amazon Nova Sonic eagerly calls tools the moment it has enough context — it completely ignores prompt-based instructions like "wait for confirmation." We spent 15+ iterations discovering that **no amount of prompt engineering works** with Nova Sonic for behavioral control. The solution was a code-enforced two-phase execution pattern: `build_outfit` only accumulates items, and a separate `confirm_outfit` tool must pass 3 backend gates (user spoke, 3-second cooldown, all 6 categories filled) before the expensive Nova Act search executes. Similarly, Nova kept mapping "necklace number 2" to the wrong parameter, so we had to redesign the tool schema from 6 integer params to a single `category` enum + `number` pair.

Identity preservation in try-on was another battle — Gemini would sometimes generate a completely different person. We solved this with face reference anchoring, strategic image ordering (garments first, identity photos last, closest to the prompt), and a validation step that detects when the output suspiciously matches the input (garment not applied).

## Accomplishments that we're proud of

- **Stella actually works** — a real-time voice stylist that searches, builds outfits, tries on clothes, animates results, and adds to cart, all through natural conversation in multiple languages
- **Multi-retailer support** — the same try-on experience works across Amazon, Shein, Temu, and Google Shopping
- **The outfit builder** — a visual wardrobe where Stella searches 6 categories simultaneously via Nova Act, displays numbered items, and the user selects by voice, with the try-on triggering automatically when all items are chosen
- **7 AI models working in harmony** — Nova Sonic, Canvas, Lite, Act, Gemini 2.5, Gemini 3 Pro, and Grok, each doing what it does best in a single cohesive product
- **Production-grade architecture** — Redis caching, S3 storage, Cognito auth, DynamoDB persistence, with 14,500+ lines of shipped code

## What we learned

- Nova Sonic is incredibly powerful for voice AI, but behavioral control MUST be enforced at the code level — prompt instructions are unreliable for controlling tool-calling timing
- Multi-model orchestration is the future — no single model does everything well, but combining specialized models (Nova for voice + classification, Gemini for image generation, Grok for video) creates a product that feels magical
- Identity preservation in AI try-on requires deliberate engineering — image ordering, face anchoring, and output validation all matter significantly
- Browser automation with Nova Act unlocks capabilities that traditional APIs can't touch — like searching Amazon with natural language and adding items to a real shopping cart

## What's next for SuperNova TryOnMe

- **Mobile app** — bringing the experience to iOS and Android with camera-based try-on
- **AR mirror mode** — real-time try-on using the webcam feed, so users can see themselves in clothes as they move
- **Social sharing** — share try-on results and animated videos directly to Instagram, TikTok, and WhatsApp
- **Size recommendation engine** — using body measurements from uploaded photos to predict the best size per brand
- **More retailers** — expanding to Zara, H&M, ASOS, and Nordstrom
- **Group styling** — Stella helps style outfits for events with multiple people (weddings, group trips)
- **Affiliate integration** — monetization through retailer partnerships, making the extension free for consumers
