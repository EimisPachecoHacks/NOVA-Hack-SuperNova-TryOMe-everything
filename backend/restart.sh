#!/bin/bash
# NovaTryOnMe — Clean restart script
# Kills zombies, reloads nginx, restarts PM2
# Usage: sudo /opt/novatryon/restart.sh

set -e
PORT=3000
APP_NAME="novatryon"

echo "[$(date)] === NovaTryOnMe Clean Restart ==="

# Step 1: Stop PM2 app
echo "[$(date)] Stopping PM2 app..."
pm2 stop $APP_NAME 2>/dev/null || true

# Step 2: Kill ALL processes on port 3000
echo "[$(date)] Killing processes on port $PORT..."
lsof -i :$PORT -t 2>/dev/null | xargs -r kill -9 2>/dev/null || true
sleep 2

# Step 3: Kill any remaining Node/Python/Chromium orphans
pkill -9 -f "node.*server.js" 2>/dev/null || true
pkill -9 -f "smart_search.py" 2>/dev/null || true
pkill -9 -f "chromium" 2>/dev/null || true
sleep 1

# Step 4: Reload nginx to drop stale upstream connections
echo "[$(date)] Reloading nginx..."
nginx -s reload 2>/dev/null || systemctl reload nginx 2>/dev/null || true
sleep 1

# Step 5: Verify port is free
if lsof -i :$PORT >/dev/null 2>&1; then
  echo "[$(date)] WARNING: Port $PORT still in use, force killing..."
  fuser -k -9 $PORT/tcp 2>/dev/null || true
  sleep 2
fi

# Step 6: Start PM2 app
echo "[$(date)] Starting PM2 app..."
cd /opt/novatryon
pm2 delete $APP_NAME 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

# Step 7: Wait and verify
sleep 5
STATUS=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:$PORT/health 2>/dev/null || echo "000")
if [ "$STATUS" = "200" ]; then
  echo "[$(date)] SUCCESS: Server running on port $PORT (health: $STATUS)"
  pm2 list
else
  echo "[$(date)] ERROR: Server not responding (health: $STATUS)"
  pm2 logs $APP_NAME --lines 10 --nostream
  exit 1
fi
