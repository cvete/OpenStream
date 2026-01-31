# Streaming Server

A self-hosted streaming server with RTMP ingest, HLS/DASH output, and comprehensive security features. Replaces Nimble Streamer with your own API and dashboard - **no WMSPanel required**.

## Features

- **RTMP Ingest**: Receive streams from OBS, FFmpeg, or any RTMP encoder
- **HLS/DASH Output**: Deliver streams to any browser or player
- **Live Streaming**: Real-time streaming with low latency
- **VOD Recording**: Automatic recording of live streams
- **Hotlinking Protection**: Secure token-based playback URLs with expiration
- **Domain Whitelisting**: Restrict playback to authorized domains only
- **Web Dashboard**: Manage streams, recordings, and security settings
- **REST API**: Full programmatic control over the server
- **Scalable**: Handles 5000+ concurrent viewers
- **Self-Contained**: No external cloud services required

## Deployment Options

| Method | Best For | Performance | Setup Difficulty |
|--------|----------|-------------|------------------|
| **Bare Metal** | Production, 5000+ viewers | Best | Medium |
| **Docker** | Development, quick testing | Good | Easy |

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  OBS/Encoder    │────▶│  SRS Server      │────▶│  HLS Segments   │
│  (RTMP Push)    │     │  (Port 1935)     │     │  (Media Files)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │                         │
                        ┌──────▼──────┐          ┌───────▼───────┐
                        │  API Server │◀────────▶│    NGINX      │
                        │  (Node.js)  │          │  (Port 80)    │
                        └──────┬──────┘          └───────────────┘
                               │
                        ┌──────▼──────┐
                        │  PostgreSQL │
                        │  + Redis    │
                        └─────────────┘
```

---

## Option A: Bare Metal Installation (Recommended for Production)

### Requirements
- Ubuntu 22.04 LTS server
- Minimum: 8 CPU cores, 16GB RAM, 500GB SSD
- Root access

### Installation Steps

1. **Copy project to server**:
   ```bash
   scp -r streaming-server/ user@your-server:/opt/
   cd /opt/streaming-server
   ```

2. **Run base installation**:
   ```bash
   chmod +x scripts/install-bare-metal.sh
   sudo ./scripts/install-bare-metal.sh
   ```
   This installs: SRS, NGINX, Node.js, PostgreSQL, Redis, FFmpeg

3. **Configure services**:
   ```bash
   chmod +x scripts/configure-services.sh
   sudo ./scripts/configure-services.sh
   ```

4. **Add your domains** to `/etc/nginx/sites-available/streaming`:
   ```nginx
   # Find and edit the referer whitelist:
   "~^https://yourdomain\.com"     1;
   "~^https://.*\.yourdomain\.com" 1;
   ```

5. **Restart NGINX**:
   ```bash
   sudo systemctl restart nginx
   ```

### Service Management

```bash
# Start all services
sudo systemctl start srs streaming-api nginx

# Stop all services
sudo systemctl stop srs streaming-api nginx

# View logs
sudo journalctl -u streaming-api -f    # API logs
sudo journalctl -u srs -f              # SRS logs
tail -f /var/log/nginx/streaming-*.log # NGINX logs

# Restart a service
sudo systemctl restart streaming-api
```

---

## Option B: Docker Installation (Easy Setup)

### Requirements
- Docker & Docker Compose installed
- Linux, macOS, or Windows with WSL2

### Installation Steps

1. **Run setup script**:
   ```bash
   chmod +x scripts/setup.sh
   ./scripts/setup.sh
   ```

   Or manually:
   ```bash
   mkdir -p media/live media/vod ssl
   docker-compose up -d
   ```

2. **View logs**:
   ```bash
   docker-compose logs -f
   ```

3. **Stop services**:
   ```bash
   docker-compose down
   ```

---

## After Installation

### Access Points

| Service | URL |
|---------|-----|
| Dashboard | http://your-server |
| API | http://your-server/api |
| RTMP Ingest | rtmp://your-server:1935/live/{stream-key} |
| HLS Playback | http://your-server/live/{stream-key}/index.m3u8 |

### Default Credentials

- **Username**: `admin`
- **Password**: `admin123`

⚠️ **Change the default password immediately!**

---

## Usage

### 1. Create a Stream

Via Dashboard:
1. Login to dashboard
2. Click "+ New Stream"
3. Enter stream name
4. Copy the stream key

Via API:
```bash
# Login first
TOKEN=$(curl -s -X POST http://your-server/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r '.token')

# Create stream
curl -X POST http://your-server/api/streams \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"My Stream"}'
```

### 2. Stream from OBS

1. Open OBS → Settings → Stream
2. Service: **Custom**
3. Server: `rtmp://your-server:1935/live`
4. Stream Key: (paste from dashboard)
5. Click "Start Streaming"

### 3. Watch the Stream

**With token (secure)**:
```
http://your-server/live/{stream-key}/index.m3u8?token={token}&expires={timestamp}
```

**Via embed player** (generates token automatically):
```html
<iframe
  src="http://your-server/embed/{stream-key}"
  width="640"
  height="360"
  allowfullscreen>
</iframe>
```

---

## Security Configuration

### Domain Whitelisting

Only allow playback from your domains:

**Via Dashboard**: Security → Add Domain

**Via API**:
```bash
# Add global domain (applies to all streams)
curl -X POST http://your-server/api/domains/global \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domain":"yourdomain.com"}'

# Add domain for specific stream
curl -X POST http://your-server/api/domains/stream/{stream-key} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domain":"partner-site.com"}'
```

### Token Settings

Tokens are automatically:
- HMAC-SHA256 signed
- Time-limited (default: 4 hours)
- Validated by NGINX before serving content

Configure token expiry in environment:
```env
TOKEN_EXPIRY_HOURS=4
```

---

## API Reference

### Authentication
```bash
POST /api/auth/login          # Login, get JWT
POST /api/auth/refresh        # Refresh token
GET  /api/auth/me             # Get current user
```

### Streams
```bash
GET    /api/streams           # List all streams
POST   /api/streams           # Create stream
GET    /api/streams/{id}      # Get stream details
PUT    /api/streams/{id}      # Update stream
DELETE /api/streams/{id}      # Delete stream
GET    /api/streams/{id}/stats # Stream statistics
```

### VOD Recordings
```bash
GET    /api/vod               # List recordings
GET    /api/vod/{id}          # Get recording
DELETE /api/vod/{id}          # Delete recording
```

### Security/Domains
```bash
GET    /api/domains/global              # List global domains
POST   /api/domains/global              # Add global domain
DELETE /api/domains/global/{domain}     # Remove global domain
GET    /api/domains/stream/{key}        # List stream domains
POST   /api/domains/stream/{key}        # Add stream domain
```

### Statistics
```bash
GET /api/stats/server         # Server stats
GET /api/stats/bandwidth      # Bandwidth stats
GET /api/stats/viewers        # Viewer stats
```

---

## SSL/HTTPS Setup (Production)

1. **Get certificates** (Let's Encrypt):
   ```bash
   sudo apt install certbot
   sudo certbot certonly --standalone -d streaming.yourdomain.com
   ```

2. **Update NGINX config**:
   ```nginx
   server {
       listen 443 ssl http2;
       server_name streaming.yourdomain.com;

       ssl_certificate /etc/letsencrypt/live/streaming.yourdomain.com/fullchain.pem;
       ssl_certificate_key /etc/letsencrypt/live/streaming.yourdomain.com/privkey.pem;

       # ... rest of config
   }

   # Redirect HTTP to HTTPS
   server {
       listen 80;
       server_name streaming.yourdomain.com;
       return 301 https://$server_name$request_uri;
   }
   ```

3. **Restart NGINX**:
   ```bash
   sudo systemctl restart nginx
   ```

---

## Hardware Requirements

| Viewers | CPU | RAM | Network | Storage |
|---------|-----|-----|---------|---------|
| 100 | 2 cores | 4 GB | 100 Mbps | 100 GB SSD |
| 1,000 | 4 cores | 8 GB | 1 Gbps | 250 GB SSD |
| 5,000 | 8 cores | 16 GB | 10 Gbps | 500 GB SSD |
| 10,000+ | 16 cores | 32 GB | 10 Gbps+ | 1 TB NVMe |

**Bandwidth calculation**: `viewers × bitrate = bandwidth`
- 5,000 viewers × 2.5 Mbps (720p) = 12.5 Gbps

---

## Troubleshooting

### Stream not playing

1. Check stream is live:
   ```bash
   curl http://localhost/api/streams/status/live
   ```

2. Verify token is valid (not expired)

3. Check domain is whitelisted

4. Check NGINX logs:
   ```bash
   tail -f /var/log/nginx/streaming-error.log
   ```

### RTMP connection refused

1. Check SRS is running:
   ```bash
   systemctl status srs          # Bare metal
   docker-compose ps srs         # Docker
   ```

2. Check port 1935 is open:
   ```bash
   sudo netstat -tlnp | grep 1935
   ```

3. View SRS logs:
   ```bash
   journalctl -u srs -f          # Bare metal
   docker-compose logs srs       # Docker
   ```

### API errors

1. Check API health:
   ```bash
   curl http://localhost/api/internal/health
   ```

2. View API logs:
   ```bash
   journalctl -u streaming-api -f   # Bare metal
   docker-compose logs api          # Docker
   ```

---

## License

MIT License
