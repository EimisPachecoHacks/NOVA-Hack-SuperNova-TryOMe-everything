#!/usr/bin/env python3
"""
Nova Act — Add to Cart automation
Uses Amazon Nova Act to open a product page and add it to the shopping cart.
Called as a subprocess from the Node.js backend.

Usage: python3 add_to_cart.py <product_url>
Output: JSON { "status": "success" | "error", "message": "..." }
"""

import sys
import json

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"status": "error", "message": "Product URL required"}))
        sys.exit(1)

    product_url = sys.argv[1]

    try:
        from nova_act import NovaAct

        with NovaAct(starting_page=product_url) as nova:
            # Wait for product page to load and click Add to Cart
            nova.act(
                "Look at the product page. Click the 'Add to Cart' button. "
                "If there are size or color options that need to be selected first, "
                "select a common/default option, then click Add to Cart. "
                "Wait for confirmation that the item was added to the cart."
            )

        print(json.dumps({
            "status": "success",
            "message": f"Product added to cart: {product_url}"
        }))
    except Exception as e:
        print(json.dumps({
            "status": "error",
            "message": str(e)
        }))
        sys.exit(1)

if __name__ == "__main__":
    main()
