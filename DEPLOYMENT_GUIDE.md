# OpenStream Deployment Guide

Quick guide to deploying OpenStream in production with the new security and performance improvements.

## 🚀 Quick Start

### 1. Generate Secrets

```bash
# Generate strong secrets (copy these to .env.production)
echo "JWT_SECRET=$(openssl rand -base64 32)"
echo "TOKEN_SECRET=$(openssl rand -base64 32)"
echo "SRS_WEBHOOK_SECRET=$(openssl rand -base64 32)"
```

### 2. Configure Environment

```bash
# Copy template
cp .env.production.example .env.production

# Edit with your values
nano .env.production
```

**Required Variables**:
```bash
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/dbname
REDIS_URL=redis://host:6379
JWT_SECRET=<generated-above>
TOKEN_SECRET=<generated-above>
SRS_WEBHOOK_SECRET=<generated-above>
ALLOWED_ORIGINS=https://yourdomain.com
SRS_WEBHOOK_IP_WHITELIST=127.0.0.1,<srs-server-ip>
```

### 3. Apply Database Migrations

```bash
# Backup first!
pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql

# Apply indexes
psql $DATABASE_URL -f api/database/migrations/002_add_indexes.sql
```

### 4. Start Application

```bash
cd api
npm ci
NODE_ENV=production npm start
```

### 5. Verify Deployment

```bash
# Health check
curl http://localhost:3000/health

# Test CORS (should succeed if origin whitelisted)
curl -H "Origin: https://yourdomain.com" http://localhost:3000/api/health

# Check logs for errors
tail -f logs/app.log
```

---

## 📋 Pre-Deployment Checklist

### Security Configuration
- [ ] JWT_SECRET is 32+ characters and not default value
- [ ] TOKEN_SECRET is 32+ characters and different from JWT_SECRET
- [ ] SRS_WEBHOOK_SECRET is set (32+ characters)
- [ ] ALLOWED_ORIGINS contains only your domains (no wildcards)
- [ ] SRS_WEBHOOK_IP_WHITELIST contains only trusted IPs
- [ ] Database password is strong (16+ characters)
- [ ] Redis is password-protected (if exposed to network)

### Infrastructure
- [ ] Database is backed up
- [ ] PostgreSQL 11+ for non-blocking index creation
- [ ] Redis 6+ for improved performance
- [ ] Sufficient disk space for media files
- [ ] Reverse proxy (NGINX) configured with SSL/TLS
- [ ] Firewall rules allow only necessary ports

### Application
- [ ] Database migrations applied (see step 3 above)
- [ ] SRS media server configured with webhook URLs
- [ ] Media directories exist and have proper permissions
- [ ] Log directory exists and is writable
- [ ] Node.js 18+ installed

---

## 🔧 SRS Configuration

Update your SRS configuration to use the webhook authentication:

```nginx
# srs.conf
http_hooks {
    enabled on;
    on_publish http://api:3000/api/hooks/publish;
    on_unpublish http://api:3000/api/hooks/unpublish;
    on_play http://api:3000/api/hooks/play;
    on_stop http://api:3000/api/hooks/stop;
    on_dvr http://api:3000/api/hooks/dvr;
    on_hls http://api:3000/api/hooks/hls;
}
```

**Important**: Make sure SRS can reach the API server from the IP specified in `SRS_WEBHOOK_IP_WHITELIST`.

---

## 🐳 Docker Deployment

### docker-compose.yml

```yaml
version: '3.8'

services:
  api:
    build: ./api
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://streaming:${DB_PASSWORD}@postgres:5432/streaming_db
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
      TOKEN_SECRET: ${TOKEN_SECRET}
      SRS_WEBHOOK_SECRET: ${SRS_WEBHOOK_SECRET}
      ALLOWED_ORIGINS: ${ALLOWED_ORIGINS}
      SRS_WEBHOOK_IP_WHITELIST: 127.0.0.1,srs
      SRS_API_URL: http://srs:1985
    depends_on:
      - postgres
      - redis
      - srs
    ports:
      - "3000:3000"
    volumes:
      - ./media:/media
    restart: unless-stopped

  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: streaming_db
      POSTGRES_USER: streaming
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./api/database/migrations:/docker-entrypoint-initdb.d
    restart: unless-stopped

  redis:
    image: redis:7
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    restart: unless-stopped

  srs:
    image: ossrs/srs:5
    volumes:
      - ./srs.conf:/usr/local/srs/conf/srs.conf
      - ./media:/media
    ports:
      - "1935:1935"   # RTMP
      - "1985:1985"   # HTTP API
      - "8080:8080"   # HTTP Server
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### Deploy with Docker

```bash
# Create .env file for Docker Compose
cat > .env << EOF
DB_PASSWORD=$(openssl rand -base64 16)
JWT_SECRET=$(openssl rand -base64 32)
TOKEN_SECRET=$(openssl rand -base64 32)
SRS_WEBHOOK_SECRET=$(openssl rand -base64 32)
ALLOWED_ORIGINS=https://yourdomain.com
EOF

# Start services
docker compose up -d

# Check logs
docker compose logs -f api

# Apply migrations (if not auto-applied)
docker compose exec postgres psql -U streaming -d streaming_db -f /docker-entrypoint-initdb.d/002_add_indexes.sql
```

---

## 🌐 NGINX Configuration

```nginx
# /etc/nginx/sites-available/openstream

upstream api {
    server localhost:3000;
}

server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # API proxy
    location /api/ {
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # Health check
    location /health {
        proxy_pass http://api;
        access_log off;
    }

    # HLS streaming
    location /hls/ {
        alias /media/live/;
        types {
            application/vnd.apple.mpegurl m3u8;
            video/mp2t ts;
        }
        add_header Cache-Control "no-cache";
        add_header Access-Control-Allow-Origin "*";
    }

    # Dashboard
    location / {
        root /var/www/openstream/dashboard;
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 🔍 Post-Deployment Verification

### 1. Check Application Startup

```bash
# Should see "Production configuration validated"
docker compose logs api | grep "configuration validated"

# Should NOT see validation errors
docker compose logs api | grep "CRITICAL"
```

### 2. Test CORS

```bash
# Whitelisted origin - should succeed
curl -i -H "Origin: https://yourdomain.com" http://localhost:3000/api/health

# Non-whitelisted origin - should fail
curl -i -H "Origin: https://evil.com" http://localhost:3000/api/health
```

### 3. Test Webhook Authentication

```bash
# From unauthorized IP - should fail with 403
curl -X POST http://localhost:3000/api/hooks/publish \
  -H "Content-Type: application/json" \
  -d '{"stream":"test","ip":"1.2.3.4"}'

# From SRS server IP - should work
# (Test from actual SRS server)
```

### 4. Monitor Performance

```bash
# Check database query performance
psql $DATABASE_URL -c "EXPLAIN ANALYZE SELECT * FROM streams WHERE stream_key = 'test123';"

# Check Redis latency
redis-cli --latency

# Monitor API response times
curl -w "@curl-format.txt" -o /dev/null -s http://localhost:3000/api/health
```

---

## 🆘 Troubleshooting

### Application Won't Start

```bash
# Check logs
docker compose logs api

# Common issues:
# - Missing environment variables → Check .env file
# - Database not ready → Wait for postgres to finish initializing
# - Port already in use → Change PORT in .env
```

### CORS Errors

```bash
# Check ALLOWED_ORIGINS is set correctly
docker compose exec api printenv ALLOWED_ORIGINS

# Test CORS with verbose curl
curl -v -H "Origin: https://yourdomain.com" http://localhost:3000/api/health
```

### Webhooks Not Working

```bash
# Check SRS can reach API
docker compose exec srs curl http://api:3000/health

# Check IP whitelist
docker compose exec api printenv SRS_WEBHOOK_IP_WHITELIST

# Check webhook logs
docker compose logs api | grep "Webhook"
```

### Performance Issues

```bash
# Check if indexes were applied
psql $DATABASE_URL -c "SELECT tablename, indexname FROM pg_indexes WHERE schemaname='public';"

# Monitor slow queries
docker compose logs api | grep "Slow query"

# Check Redis memory
redis-cli info memory
```

---

## 📊 Monitoring

### Key Metrics to Monitor

1. **API Response Time**: Should be <100ms for most endpoints
2. **Database Query Time**: Should be <50ms with indexes
3. **Redis Latency**: Should be <1ms
4. **Error Rate**: Should be <0.1%
5. **Active Streams**: Monitor for anomalies
6. **Viewer Count**: Track concurrent viewers

### Logging

```bash
# View API logs
docker compose logs -f --tail=100 api

# View error logs only
docker compose logs api | grep ERROR

# View webhook logs
docker compose logs api | grep "hook"
```

---

## 🔐 Security Maintenance

### Regular Tasks

1. **Rotate Secrets** (every 90 days)
   ```bash
   # Generate new secrets
   NEW_JWT_SECRET=$(openssl rand -base64 32)
   # Update .env and restart
   ```

2. **Update Dependencies** (monthly)
   ```bash
   cd api
   npm audit
   npm update
   ```

3. **Review Logs** (weekly)
   ```bash
   # Check for security warnings
   docker compose logs api | grep -i "warn\|error\|security"
   ```

4. **Backup Database** (daily)
   ```bash
   pg_dump $DATABASE_URL > backup_$(date +%Y%m%d).sql
   ```

---

## 📚 Additional Resources

- Full implementation details: `PRODUCTION_READINESS.md`
- Database migrations: `api/database/migrations/README.md`
- Environment template: `.env.production.example`

---

**Questions?** Open an issue or review the PRODUCTION_READINESS.md file.
