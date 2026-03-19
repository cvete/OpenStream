#!/bin/bash

# Streaming Server Setup Script
# Run this script to initialize the streaming server

set -e

echo "========================================"
echo "  Streaming Server Setup"
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -eq 0 ]; then
    echo -e "${YELLOW}Warning: Running as root. Consider using a non-root user.${NC}"
fi

# Check Docker
echo "Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Docker is not installed. Please install Docker first.${NC}"
    echo "Visit: https://docs.docker.com/engine/install/"
    exit 1
fi
echo -e "${GREEN}Docker is installed.${NC}"

# Check Docker Compose
echo "Checking Docker Compose..."
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo -e "${RED}Docker Compose is not installed. Please install Docker Compose first.${NC}"
    exit 1
fi
echo -e "${GREEN}Docker Compose is installed.${NC}"

# Create necessary directories
echo ""
echo "Creating directories..."
mkdir -p media/live media/vod ssl
chmod 755 media media/live media/vod
echo -e "${GREEN}Directories created.${NC}"

# Generate secrets if not set
echo ""
echo "Setting up environment variables..."

if [ ! -f .env ]; then
    # Generate random secrets
    TOKEN_SECRET=$(openssl rand -hex 32)
    JWT_SECRET=$(openssl rand -hex 32)

    cat > .env << EOF
# Streaming Server Environment Variables
# Generated on $(date)

# Security - CHANGE THESE IN PRODUCTION!
TOKEN_SECRET=${TOKEN_SECRET}
JWT_SECRET=${JWT_SECRET}

# Database
POSTGRES_USER=streaming
POSTGRES_PASSWORD=$(openssl rand -hex 16)
POSTGRES_DB=streaming_db

# Server Configuration
NODE_ENV=production
PORT=3000

# SRS Configuration
SRS_API_URL=http://srs:1985

# Optional: Maximum viewers per stream
MAX_VIEWERS_PER_STREAM=5000

# Optional: Token expiry in hours
TOKEN_EXPIRY_HOURS=4
EOF

    echo -e "${GREEN}.env file created with random secrets.${NC}"
    echo -e "${YELLOW}IMPORTANT: Review and modify .env file before production use!${NC}"
else
    echo -e "${YELLOW}.env file already exists, skipping...${NC}"
fi

# Build dashboard (placeholder)
echo ""
echo "Setting up dashboard..."
if [ ! -f dashboard/dist/index.html ]; then
    mkdir -p dashboard/dist
    cat > dashboard/dist/index.html << 'EOF'
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Streaming Server Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #fff;
        }
        .container {
            text-align: center;
            padding: 40px;
            background: rgba(255,255,255,0.05);
            border-radius: 20px;
            backdrop-filter: blur(10px);
            max-width: 600px;
        }
        h1 { font-size: 2.5rem; margin-bottom: 20px; }
        p { color: #aaa; margin-bottom: 30px; line-height: 1.6; }
        .status { display: flex; gap: 20px; justify-content: center; flex-wrap: wrap; }
        .status-item {
            background: rgba(255,255,255,0.1);
            padding: 20px 30px;
            border-radius: 10px;
            min-width: 120px;
        }
        .status-item h3 { font-size: 2rem; color: #4ade80; }
        .status-item span { color: #888; font-size: 0.9rem; }
        .api-info {
            margin-top: 30px;
            padding: 20px;
            background: rgba(0,0,0,0.2);
            border-radius: 10px;
            text-align: left;
        }
        .api-info h4 { margin-bottom: 10px; color: #4ade80; }
        code {
            background: rgba(0,0,0,0.3);
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 0.9em;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎬 Streaming Server</h1>
        <p>Your self-hosted streaming server is running successfully.<br>
           Full dashboard coming soon!</p>

        <div class="status">
            <div class="status-item">
                <h3 id="live-count">-</h3>
                <span>Live Streams</span>
            </div>
            <div class="status-item">
                <h3 id="viewer-count">-</h3>
                <span>Viewers</span>
            </div>
            <div class="status-item">
                <h3 id="vod-count">-</h3>
                <span>Recordings</span>
            </div>
        </div>

        <div class="api-info">
            <h4>API Endpoints</h4>
            <p><code>GET /api/stats/server</code> - Server statistics</p>
            <p><code>POST /api/auth/login</code> - Admin login</p>
            <p><code>GET /api/streams</code> - List streams</p>
            <p><code>POST /api/streams</code> - Create stream</p>
            <p style="margin-top: 10px; color: #888;">
                Create admin: <code>npm run create-admin</code>
            </p>
        </div>
    </div>

    <script>
        // Fetch stats
        async function loadStats() {
            try {
                const response = await fetch('/api/stats/server');
                const data = await response.json();

                document.getElementById('live-count').textContent = data.live_streams || 0;
                document.getElementById('viewer-count').textContent = data.current_viewers || 0;
                document.getElementById('vod-count').textContent = data.total_recordings || 0;
            } catch (error) {
                console.log('Could not load stats:', error);
            }
        }

        loadStats();
        setInterval(loadStats, 10000);
    </script>
</body>
</html>
EOF
    echo -e "${GREEN}Dashboard placeholder created.${NC}"
fi

# Pull Docker images
echo ""
echo "Pulling Docker images..."
docker-compose pull
echo -e "${GREEN}Docker images pulled.${NC}"

# Start services
echo ""
echo "Starting services..."
docker-compose up -d

echo ""
echo "========================================"
echo -e "${GREEN}  Setup Complete!${NC}"
echo "========================================"
echo ""
echo "Services are starting up. This may take a moment."
echo ""
echo "Access points:"
echo "  - Dashboard:     http://localhost"
echo "  - API:           http://localhost/api"
echo "  - RTMP Ingest:   rtmp://localhost:1935/live/{stream-key}"
echo "  - HLS Playback:  http://localhost/live/{stream-key}/index.m3u8"
echo ""
echo -e "${YELLOW}IMPORTANT: Create your admin account:${NC}"
echo "  docker-compose exec api npm run create-admin -- --username admin --email admin@yourdomain.com --password YOUR_SECURE_PASSWORD"
echo ""
echo "To view logs:    docker-compose logs -f"
echo "To stop:         docker-compose down"
echo ""
