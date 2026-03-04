# SuperNova TryOnMe — Video Voiceover Script

Imagine you're shopping for clothes online. You find a shirt you love, but you hesitate. Will it actually look good on me? Will the color match my skin tone? What about the fit? Today, seventy percent of online clothing returns happen because the item didn't look the way the shopper expected. That's a forty billion dollar problem in the US alone. And until now, there was no real solution.

Meet SuperNova TryOnMe — an AI-powered Chrome extension that lets you see any piece of clothing on your own body, before you buy it. Not on a model. Not on a mannequin. On you. Your face, your body, your skin tone. This is the future of online shopping, and it works right inside Amazon.

Here's how it works. You install the extension, create an account, and upload five photos of yourself — three full-body shots and two face close-ups. Our AI then generates three professional model poses of you, with perfect lighting and a clean studio background. These become your virtual fitting room photos. The whole setup takes about two minutes, and you only do it once.

Now let's see it in action.

You're browsing Amazon, and you land on a product page — let's say a summer top. You'll notice a new button on the product image: "Try It On." Click it, and within seconds, you see yourself wearing that exact top. The AI preserves your face, your hairstyle, your body shape — everything. It's photorealistic, and it feels like looking in a mirror.

But here's where it gets really smart. Change the color swatch on Amazon — pick the blue version instead of the red — and the try-on automatically refreshes with the new color. No extra clicks. You can switch between three different poses, toggle between full body and half body framing, and even click the result image to see it full screen.

Love the look? Save it to your favorites with one click. Want to see it in motion? Hit the Animate button, and the AI generates a short video of you wearing the outfit with natural, runway-style movement.

Now, what if you don't know exactly what you're looking for? That's where AI Smart Search comes in. Open the extension and type something like "elegant black dress for a dinner party." Behind the scenes, an AI agent — powered by Amazon Nova Act — actually opens a browser, navigates to Amazon, types the search, applies quality filters, scrolls through results, and brings back over twenty curated products. Each one comes with a Try On button, so you can virtually try on any result instantly. It's like having a personal shopper who understands natural language and does all the browsing for you.

But we didn't stop there. The Outfit Builder takes things to another level. Instead of trying on one piece at a time, you can describe an entire outfit — a top, a bottom, and shoes — each in your own words. The AI searches Amazon for all three categories at the same time, and presents a virtual wardrobe. You see hangers on a closet wall and a shoe rack below. Pick one item from each category, mix and match freely, and when you're ready, hit Try On. The AI dresses you in the complete outfit — all garments at once — in a single generation. You see yourself in a full coordinated look, ready to buy everything with direct links to Amazon.

So what's powering all of this? Under the hood, SuperNova TryOnMe uses a multi-model AI pipeline. Amazon Nova 2 Lite handles fast product classification — identifying garment types, detecting what you're currently wearing, and resolving outfit conflicts. Amazon Nova Canvas powers background removal and cosmetics try-on. Google Gemini handles the core image generation — the actual virtual try-on — using multi-image prompts with identity preservation. And Grok from xAI generates the animation videos.

On the infrastructure side, everything runs on AWS. Amazon Cognito manages user authentication. S3 stores your photos and try-on results. DynamoDB handles your profile and favorites. And Amazon Bedrock provides the unified API for all Nova model interactions. The Chrome extension communicates with a Node.js backend that orchestrates the entire pipeline — from product analysis to garment extraction to the final photorealistic result.

SuperNova TryOnMe transforms online shopping from a guessing game into a confident, visual, and deeply personal experience. No more returns because the shirt didn't fit. No more wondering if that dress will look good on you. Now you know — because you've already seen it.
