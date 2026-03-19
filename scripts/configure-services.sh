#!/bin/bash

# Streaming Server - Service Configuration Script
# Run after install-bare-metal.sh

set -e

echo "========================================"
echo "  Configuring Services"
echo "========================================"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root${NC}"
    exit 1
fi

# Configuration
INSTALL_DIR="/opt/streaming-server"
MEDIA_DIR="/var/media/streaming"
USER="streaming"
GROUP="streaming"

# Get script directory (where config files are)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo -e "${GREEN}[1/6] Copying API files...${NC}"
cp -r "$PROJECT_DIR/api" "$INSTALL_DIR/"
cd "$INSTALL_DIR/api"
npm ci --only=production
chown -R $USER:$GROUP "$INSTALL_DIR/api"

echo -e "${GREEN}[2/6] Configuring SRS...${NC}"
mkdir -p /usr/local/srs/conf
cat > /usr/local/srs/conf/srs.conf <<'EOF'
listen              1935;
max_connections     5000;
daemon              on;
srs_log_tank        file;
srs_log_file        /var/log/streaming-server/srs.log;
srs_log_level       info;
pid                 /var/run/srs.pid;

http_api {
    enabled         on;
    listen          127.0.0.1:1985;
}

http_server {
    enabled         on;
    listen          127.0.0.1:8080;
    dir             /var/media/streaming/live;
}

vhost __defaultVhost__ {
    tcp_nodelay     on;
    min_latency     on;
    gop_cache       on;

    hls {
        enabled         on;
        hls_path        /var/media/streaming/live;
        hls_fragment    2;
        hls_window      60;
        hls_cleanup     on;
        hls_dispose     30;
    }

    dvr {
        enabled         on;
        dvr_path        /var/media/streaming/vod/[stream]/[timestamp].flv;
        dvr_plan        session;
    }

    http_hooks {
        enabled         on;
        on_publish      http://127.0.0.1:3000/api/hooks/publish;
        on_unpublish    http://127.0.0.1:3000/api/hooks/unpublish;
        on_play         http://127.0.0.1:3000/api/hooks/play;
        on_stop         http://127.0.0.1:3000/api/hooks/stop;
        on_dvr          http://127.0.0.1:3000/api/hooks/dvr;
    }
}
EOF

echo -e "${GREEN}[3/6] Configuring NGINX...${NC}"
# Backup default config
mv /etc/nginx/sites-enabled/default /etc/nginx/sites-enabled/default.bak 2>/dev/null || true

cat > /etc/nginx/sites-available/streaming <<'EOF'
# Rate limiting
limit_conn_zone $binary_remote_addr zone=stream_conn:10m;
limit_req_zone $binary_remote_addr zone=stream_req:10m rate=30r/s;
limit_req_zone $binary_remote_addr zone=api_req:10m rate=10r/s;

# Referer whitelist - ADD YOUR DOMAINS HERE
map $http_referer $valid_referer {
    default                           0;
    ""                                1;
    "~^https?://localhost"            1;
    "~^https?://127\.0\.0\.1"         1;
    # Add your domains:
    # "~^https://yourdomain\.com"     1;
}

# CORS origins - ADD YOUR DOMAINS HERE
map $http_origin $cors_origin {
    default "";
    "~^https?://localhost(:\d+)?$" $http_origin;
    "~^https?://127\.0\.0\.1(:\d+)?$" $http_origin;
    # Add your domains:
    # "~^https://yourdomain\.com$" $http_origin;
}

upstream api_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen 80;
    server_name _;

    access_log /var/log/nginx/streaming-access.log;
    error_log /var/log/nginx/streaming-error.log;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    # Health check
    location /health {
        return 200 "healthy\n";
        add_header Content-Type text/plain;
    }

    # Live streams with security
    location /live/ {
        auth_request /internal/validate-token;

        if ($valid_referer = 0) {
            return 403;
        }

        limit_conn stream_conn 10;
        limit_req zone=stream_req burst=50 nodelay;

        alias /var/media/streaming/live/;

        add_header Access-Control-Allow-Origin $cors_origin always;
        add_header Access-Control-Allow-Methods "GET, OPTIONS" always;
        add_header Cache-Control "no-cache" always;

        types {
            application/vnd.apple.mpegurl m3u8;
            video/mp2t ts;
        }
    }

    # VOD with security
    location /vod/ {
        auth_request /internal/validate-token;

        if ($valid_referer = 0) {
            return 403;
        }

        alias /var/media/streaming/vod/;
        add_header Access-Control-Allow-Origin $cors_origin always;
    }

    # Token validation
    location = /internal/validate-token {
        internal;
        proxy_pass http://api_backend/api/internal/validate-token;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header X-Original-URI $request_uri;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Embed player
    location /embed/ {
        proxy_pass http://api_backend;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # API
    location /api/ {
        limit_req zone=api_req burst=20 nodelay;

        proxy_pass http://api_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Dashboard
    location / {
        root /opt/streaming-server/dashboard;
        index index.html;
        try_files $uri $uri/ /index.html;
    }
}
EOF

ln -sf /etc/nginx/sites-available/streaming /etc/nginx/sites-enabled/streaming

echo -e "${GREEN}[4/6] Copying dashboard...${NC}"
mkdir -p "$INSTALL_DIR/dashboard"
cp -r "$PROJECT_DIR/dashboard/dist/"* "$INSTALL_DIR/dashboard/"
chown -R $USER:$GROUP "$INSTALL_DIR/dashboard"

echo -e "${GREEN}[5/6] Initializing database...${NC}"
# Load environment
source /etc/streaming-server/.env
PGPASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\([^@]*\)@.*/\1/p')
PGUSER=$(echo $DATABASE_URL | sed -n 's/.*\/\/\([^:]*\):.*/\1/p')
PGHOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
PGDB=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

export PGPASSWORD
psql -h $PGHOST -U $PGUSER -d $PGDB -f "$PROJECT_DIR/database/init.sql"

echo -e "${GREEN}[6/6] Creating systemd services...${NC}"

# SRS Service
cat > /etc/systemd/system/srs.service <<EOF
[Unit]
Description=SRS Media Server
After=network.target

[Service]
Type=forking
PIDFile=/var/run/srs.pid
ExecStart=/usr/local/srs/objs/srs -c /usr/local/srs/conf/srs.conf
ExecReload=/bin/kill -HUP \$MAINPID
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# API Service
cat > /etc/systemd/system/streaming-api.service <<EOF
[Unit]
Description=Streaming Server API
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=$USER
Group=$GROUP
WorkingDirectory=$INSTALL_DIR/api
EnvironmentFile=/etc/streaming-server/.env
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Reload and enable services
systemctl daemon-reload
systemctl enable srs streaming-api nginx postgresql redis-server
systemctl restart srs streaming-api nginx

echo ""
echo -e "${GREEN}========================================"
echo "  Configuration Complete!"
echo "========================================${NC}"
echo ""
echo "Services status:"
systemctl is-active srs && echo -e "  SRS:        ${GREEN}Running${NC}" || echo -e "  SRS:        ${RED}Not running${NC}"
systemctl is-active streaming-api && echo -e "  API:        ${GREEN}Running${NC}" || echo -e "  API:        ${RED}Not running${NC}"
systemctl is-active nginx && echo -e "  NGINX:      ${GREEN}Running${NC}" || echo -e "  NGINX:      ${RED}Not running${NC}"
systemctl is-active postgresql && echo -e "  PostgreSQL: ${GREEN}Running${NC}" || echo -e "  PostgreSQL: ${RED}Not running${NC}"
systemctl is-active redis-server && echo -e "  Redis:      ${GREEN}Running${NC}" || echo -e "  Redis:      ${RED}Not running${NC}"
echo ""
echo "Access points:"
echo "  Dashboard:    http://your-server"
echo "  RTMP:         rtmp://your-server:1935/live/{stream-key}"
echo "  HLS:          http://your-server/live/{stream-key}/index.m3u8"
echo ""
echo -e "${YELLOW}Create your admin account:${NC}"
echo "  cd /opt/streaming-server/api && npm run create-admin -- --username admin --email admin@yourdomain.com --password YOUR_SECURE_PASSWORD"
echo ""
echo "Useful commands:"
echo "  systemctl status srs            # Check SRS status"
echo "  systemctl status streaming-api  # Check API status"
echo "  journalctl -u streaming-api -f  # View API logs"
echo "  journalctl -u srs -f            # View SRS logs"
echo ""
