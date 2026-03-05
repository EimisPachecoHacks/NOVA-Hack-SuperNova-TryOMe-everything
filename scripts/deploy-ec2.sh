#!/bin/bash
set -e

# NovaTryOnMe — Deploy backend to EC2
# Usage: ./scripts/deploy-ec2.sh

EC2_IP="98.91.240.78"
KEY="/tmp/NovaTryOnMe-Key.pem"
REMOTE_DIR="/opt/novatryon"
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10 -i $KEY"

echo "=== NovaTryOnMe EC2 Deployment ==="
echo "Target: ec2-user@$EC2_IP"

# 1. Package the backend (exclude node_modules, venv, __pycache__)
echo ""
echo "📦 Packaging backend..."
cd "$(dirname "$0")/../backend"
tar czf /tmp/novatryon-backend.tar.gz \
  --exclude='node_modules' \
  --exclude='python-services/venv' \
  --exclude='python-services/__pycache__' \
  --exclude='.env' \
  .

echo "   Archive: $(du -h /tmp/novatryon-backend.tar.gz | cut -f1)"

# 2. Upload to EC2
echo ""
echo "📤 Uploading to EC2..."
scp $SSH_OPTS /tmp/novatryon-backend.tar.gz ec2-user@$EC2_IP:/tmp/

# 3. Upload .env separately
echo "📤 Uploading .env..."
scp $SSH_OPTS .env ec2-user@$EC2_IP:/tmp/novatryon.env

# 4. Deploy on EC2
echo ""
echo "🚀 Deploying on EC2..."
ssh $SSH_OPTS ec2-user@$EC2_IP << 'DEPLOY'
set -e

# Extract
sudo mkdir -p /opt/novatryon
sudo chown ec2-user:ec2-user /opt/novatryon
cd /opt/novatryon
rm -rf middleware routes services utils assets python-services server.js package.json package-lock.json
tar xzf /tmp/novatryon-backend.tar.gz
cp /tmp/novatryon.env .env

# Install Node dependencies
echo "📥 Installing npm dependencies..."
npm ci --production 2>&1 | tail -3

# Install Python dependencies for smart search
echo "📥 Installing Python dependencies..."
cd python-services
python3.11 -m venv venv 2>/dev/null || python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt -q 2>&1 | tail -3
deactivate
cd ..

# Start/restart with PM2
echo "🔄 Starting with PM2..."
pm2 delete novatryon 2>/dev/null || true
pm2 start server.js --name novatryon --env production
pm2 save
pm2 startup systemd -u ec2-user --hp /home/ec2-user 2>&1 | grep "sudo" | bash 2>/dev/null || true

echo ""
echo "✅ Deployment complete!"
pm2 status
DEPLOY

echo ""
echo "=== Deployment finished ==="
echo "Backend URL: http://$EC2_IP"
echo "Health check: http://$EC2_IP/"
