#!/bin/bash

# Streaming Server - Bare Metal Installation Script
# For Ubuntu 22.04 LTS
# Run as root or with sudo

set -e

echo "========================================"
echo "  Streaming Server - Bare Metal Install"
echo "========================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root (sudo ./install-bare-metal.sh)${NC}"
    exit 1
fi

# Configuration
INSTALL_DIR="/opt/streaming-server"
MEDIA_DIR="/var/media/streaming"
LOG_DIR="/var/log/streaming-server"
USER="streaming"
GROUP="streaming"

echo -e "${YELLOW}This script will install:${NC}"
echo "  - SRS 5.0 (RTMP/HLS server)"
echo "  - NGINX (HTTP server)"
echo "  - Node.js 20 (API server)"
echo "  - PostgreSQL 15 (Database)"
echo "  - Redis 7 (Cache)"
echo "  - FFmpeg (Transcoding)"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

# Update system
echo ""
echo -e "${GREEN}[1/10] Updating system...${NC}"
apt update && apt upgrade -y

# Install dependencies
echo ""
echo -e "${GREEN}[2/10] Installing dependencies...${NC}"
apt install -y \
    curl \
    wget \
    git \
    build-essential \
    unzip \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release

# Create user
echo ""
echo -e "${GREEN}[3/10] Creating streaming user...${NC}"
if ! id "$USER" &>/dev/null; then
    useradd -r -s /bin/false -m -d /home/$USER $USER
fi

# Install Node.js 20
echo ""
echo -e "${GREEN}[4/10] Installing Node.js 20...${NC}"
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node --version
npm --version

# Install PostgreSQL 15
echo ""
echo -e "${GREEN}[5/10] Installing PostgreSQL 15...${NC}"
sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -
apt update
apt install -y postgresql-15 postgresql-contrib-15

# Start PostgreSQL
systemctl enable postgresql
systemctl start postgresql

# Create database and user
echo ""
echo -e "${GREEN}[6/10] Setting up database...${NC}"
DB_PASSWORD=$(openssl rand -hex 16)
sudo -u postgres psql <<EOF
CREATE USER streaming WITH PASSWORD '${DB_PASSWORD}';
CREATE DATABASE streaming_db OWNER streaming;
GRANT ALL PRIVILEGES ON DATABASE streaming_db TO streaming;
\c streaming_db
GRANT ALL ON SCHEMA public TO streaming;
EOF

# Install Redis
echo ""
echo -e "${GREEN}[7/10] Installing Redis...${NC}"
apt install -y redis-server
systemctl enable redis-server
systemctl start redis-server

# Install NGINX
echo ""
echo -e "${GREEN}[8/10] Installing NGINX...${NC}"
apt install -y nginx
systemctl enable nginx

# Install FFmpeg
echo ""
echo -e "${GREEN}[9/10] Installing FFmpeg...${NC}"
apt install -y ffmpeg
ffmpeg -version

# Install SRS
echo ""
echo -e "${GREEN}[10/10] Installing SRS 5.0...${NC}"
cd /tmp
git clone --depth 1 https://github.com/ossrs/srs.git
cd srs/trunk
./configure
make -j$(nproc)
make install

# Create directories
echo ""
echo -e "${GREEN}Creating directories...${NC}"
mkdir -p $INSTALL_DIR
mkdir -p $MEDIA_DIR/live
mkdir -p $MEDIA_DIR/vod
mkdir -p $LOG_DIR
mkdir -p /etc/streaming-server

# Set permissions
chown -R $USER:$GROUP $INSTALL_DIR
chown -R $USER:$GROUP $MEDIA_DIR
chown -R $USER:$GROUP $LOG_DIR

# Generate secrets
TOKEN_SECRET=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 32)

# Create environment file
cat > /etc/streaming-server/.env <<EOF
# Streaming Server Configuration
# Generated on $(date)

NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://streaming:${DB_PASSWORD}@localhost:5432/streaming_db

# Redis
REDIS_URL=redis://localhost:6379

# Security - KEEP THESE SECRET!
TOKEN_SECRET=${TOKEN_SECRET}
JWT_SECRET=${JWT_SECRET}

# SRS
SRS_API_URL=http://127.0.0.1:1985

# Media paths
MEDIA_PATH=${MEDIA_DIR}
MEDIA_LIVE_PATH=${MEDIA_DIR}/live
MEDIA_VOD_PATH=${MEDIA_DIR}/vod

# Settings
MAX_VIEWERS_PER_STREAM=5000
TOKEN_EXPIRY_HOURS=4
EOF

chmod 600 /etc/streaming-server/.env
chown $USER:$GROUP /etc/streaming-server/.env

echo ""
echo -e "${GREEN}========================================"
echo "  Base Installation Complete!"
echo "========================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Copy API files to $INSTALL_DIR/api"
echo "  2. Copy config files (see setup instructions)"
echo "  3. Run: sudo ./configure-services.sh"
echo ""
echo "Database password saved to /etc/streaming-server/.env"
echo ""
