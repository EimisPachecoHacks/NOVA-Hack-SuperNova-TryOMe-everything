#!/usr/bin/env python3
"""
Local HTTP server for Nova Act — Add to Cart automation.
Runs on the user's local machine (where they are logged into Amazon).
Nova Act runs headless using the user's Chrome profile cookies.

Usage: python3 cart_server.py
Listens on http://localhost:7860
"""

import json
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from nova_act import NovaAct

PORT = 7860


class CartHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self._cors_headers()
        self.end_headers()

    def do_GET(self):
        """Health check."""
        if self.path == "/" or self.path == "/health":
            self._json_response({"status": "ok", "service": "nova-act-cart-server"})
        else:
            self._json_response({"error": "Not found"}, 404)

    def do_POST(self):
        """Add products to cart."""
        if self.path != "/add-to-cart":
            self._json_response({"error": "Not found"}, 404)
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
            product_urls = body.get("productUrls", [])

            if not product_urls:
                self._json_response({"error": "productUrls array is required"}, 400)
                return

            print(f"\n[cart-server] Adding {len(product_urls)} item(s) to cart...")
            results = []

            for url in product_urls:
                print(f"[cart-server]   Processing: {url}")
                try:
                    with NovaAct(
                        starting_page=url,
                        headless=True,
                    ) as nova:
                        result = nova.act(
                            "Look at the product page. Click the 'Add to Cart' button. "
                            "If there are size or color options that need to be selected first, "
                            "select a common/default option, then click Add to Cart. "
                            "Wait for confirmation that the item was added to the cart."
                        )
                        success = result.response and "success" in result.response.lower() if result.response else True
                        results.append({
                            "url": url,
                            "status": "success" if success else "error",
                            "message": result.response or "Added to cart"
                        })
                        print(f"[cart-server]   ✓ Done: {result.response}")
                except Exception as e:
                    print(f"[cart-server]   ✗ Failed: {e}")
                    results.append({"url": url, "status": "error", "message": str(e)})

            all_success = all(r["status"] == "success" for r in results)
            success_count = sum(1 for r in results if r["status"] == "success")
            self._json_response({
                "status": "success" if all_success else "partial",
                "message": f"{success_count}/{len(results)} item(s) added to cart",
                "results": results,
            })

        except Exception as e:
            print(f"[cart-server] Error: {e}")
            self._json_response({"error": str(e)}, 500)

    def _json_response(self, data, status=200):
        self.send_response(status)
        self._cors_headers()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")

    def log_message(self, format, *args):
        """Suppress default request logging — we log manually."""
        pass


def main():
    server = HTTPServer(("127.0.0.1", PORT), CartHandler)
    print(f"[cart-server] Nova Act cart server running on http://localhost:{PORT}")
    print(f"[cart-server] POST /add-to-cart  {{ productUrls: [...] }}")
    print(f"[cart-server] Uses headless Chrome with your local profile (Amazon login preserved)")
    print()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[cart-server] Shutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
