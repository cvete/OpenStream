# OpenStream - Docker Desktop Setup Guide

## 🐳 Running OpenStream with Docker Desktop on Windows

This guide will help you run OpenStream using Docker Desktop on Windows.

---

## Prerequisites

1. **Docker Desktop for Windows**
   - Download from: https://www.docker.com/products/docker-desktop
   - Install and ensure it's running
   - WSL 2 backend recommended

2. **Git** (if not already installed)
   - Download from: https://git-scm.com/download/win

---

## Quick Start (5 Minutes)

### Step 1: Create Docker Compose File

Create `docker-compose.yml` in the project root:

```yaml
version: '3.8'

services:
  # PostgreSQL Database
  postgres:
    image: postgres:15-alpine
    container_name: openstream-postgres
    environment:
      POSTGRES_DB: streaming_db
      POSTGRES_USER: streaming
      POSTGRES_PASSWORD: streaming_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./api/database/schema:/docker-entrypoint-initdb.d
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U streaming"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Redis Cache
  redis:
    image: redis:7-alpine
    container_name: openstream-redis
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # OpenStream API
  api:
    build:
      context: ./api
      dockerfile: Dockerfile
    container_name: openstream-api
    environment:
      NODE_ENV: production
      PORT: 3000
      DATABASE_URL: postgresql://streaming:streaming_password@postgres:5432/streaming_db
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET:-change-this-in-production-min-32-chars}
      TOKEN_SECRET: ${TOKEN_SECRET:-change-this-in-production-min-32-chars}
      ALLOWED_ORIGINS: ${ALLOWED_ORIGINS:-http://localhost:3001,http://localhost:5173}
      SENTRY_DSN: ${SENTRY_DSN:-}
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./media:/media
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### Step 2: Create Dockerfile for API

Create `api/Dockerfile`:

```dockerfile
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["npm", "start"]
```

### Step 3: Create .env File

Create `.env` in the project root:

```env
# JWT & Token Secrets (CHANGE THESE!)
JWT_SECRET=your-secure-jwt-secret-minimum-32-characters-required
TOKEN_SECRET=your-secure-token-secret-minimum-32-characters-required

# CORS Origins
ALLOWED_ORIGINS=http://localhost:3001,http://localhost:5173

# Sentry (Optional)
SENTRY_DSN=

# SRS Configuration
SRS_API_URL=http://localhost:1985
SRS_RTMP_PORT=1935
```

### Step 4: Start Docker Containers

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f api

# Check status
docker-compose ps
```

### Step 5: Run Database Migrations

```bash
# Run migrations inside the API container
docker-compose exec api npm run migrate
```

### Step 6: Verify Installation

```bash
# Check API health
curl http://localhost:3000/health

# Should return:
# {"status":"healthy","timestamp":"...","uptime":...}
```

---

## 🎯 Container Management

### View Running Containers
```bash
docker-compose ps
```

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api
docker-compose logs -f postgres
docker-compose logs -f redis
```

### Stop Containers
```bash
docker-compose stop
```

### Start Containers
```bash
docker-compose start
```

### Restart Containers
```bash
docker-compose restart
docker-compose restart api  # Restart only API
```

### Stop and Remove Containers
```bash
docker-compose down

# Remove volumes too (CAUTION: deletes data)
docker-compose down -v
```

---

## 🔧 Development with Docker

### Development Mode with Hot Reload

Create `docker-compose.dev.yml`:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    container_name: openstream-postgres-dev
    environment:
      POSTGRES_DB: streaming_db
      POSTGRES_USER: streaming
      POSTGRES_PASSWORD: streaming_password
    ports:
      - "5432:5432"
    volumes:
      - postgres_dev_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: openstream-redis-dev
    ports:
      - "6379:6379"

  api:
    build:
      context: ./api
      dockerfile: Dockerfile.dev
    container_name: openstream-api-dev
    environment:
      NODE_ENV: development
      PORT: 3000
      DATABASE_URL: postgresql://streaming:streaming_password@postgres:5432/streaming_db
      REDIS_URL: redis://redis:6379
      JWT_SECRET: dev-jwt-secret-32-characters-minimum
      TOKEN_SECRET: dev-token-secret-32-characters-minimum
    ports:
      - "3000:3000"
    depends_on:
      - postgres
      - redis
    volumes:
      - ./api:/app
      - /app/node_modules
    command: npm run dev

volumes:
  postgres_dev_data:
```

Create `api/Dockerfile.dev`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]
```

Run development mode:
```bash
docker-compose -f docker-compose.dev.yml up
```

---

## 🧪 Running Tests in Docker

```bash
# Run all tests
docker-compose exec api npm test

# Run unit tests only
docker-compose exec api npm run test:unit

# Run with coverage
docker-compose exec api npm run test:coverage
```

---

## 📊 Database Management

### Access PostgreSQL
```bash
# Connect to PostgreSQL container
docker-compose exec postgres psql -U streaming -d streaming_db

# Inside PostgreSQL:
\dt              # List tables
\d streams       # Describe streams table
SELECT * FROM users;
\q               # Exit
```

### Backup Database
```bash
# Create backup
docker-compose exec postgres pg_dump -U streaming streaming_db > backup.sql

# Restore backup
docker-compose exec -T postgres psql -U streaming -d streaming_db < backup.sql
```

### Reset Database
```bash
# Stop API
docker-compose stop api

# Drop and recreate database
docker-compose exec postgres psql -U streaming -c "DROP DATABASE streaming_db;"
docker-compose exec postgres psql -U streaming -c "CREATE DATABASE streaming_db;"

# Run migrations
docker-compose exec api npm run migrate

# Start API
docker-compose start api
```

---

## 🐛 Troubleshooting

### Port Already in Use
```bash
# Check what's using the port
netstat -ano | findstr :3000
netstat -ano | findstr :5432

# Kill the process (replace PID)
taskkill /PID <PID> /F

# Or change port in docker-compose.yml
ports:
  - "3001:3000"  # Map host 3001 to container 3000
```

### Container Won't Start
```bash
# Check logs
docker-compose logs api

# Rebuild container
docker-compose build --no-cache api
docker-compose up -d
```

### Database Connection Failed
```bash
# Ensure PostgreSQL is healthy
docker-compose ps

# Check PostgreSQL logs
docker-compose logs postgres

# Verify connection string
docker-compose exec api printenv DATABASE_URL
```

### Permission Denied Errors
```bash
# On Windows with WSL2, ensure Docker Desktop has access
# Settings -> Resources -> WSL Integration -> Enable for your distro
```

### Out of Disk Space
```bash
# Clean up Docker
docker system prune -a
docker volume prune

# Remove unused images
docker image prune -a
```

---

## 🚀 Production Deployment with Docker

### Production docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15-alpine
    restart: always
    environment:
      POSTGRES_DB: streaming_db
      POSTGRES_USER: streaming
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U streaming"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - redis_data:/data

  api:
    build:
      context: ./api
      dockerfile: Dockerfile
    restart: always
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://streaming:${DB_PASSWORD}@postgres:5432/streaming_db
      REDIS_URL: redis://redis:6379
      JWT_SECRET_FILE: /run/secrets/jwt_secret
      TOKEN_SECRET_FILE: /run/secrets/token_secret
    secrets:
      - jwt_secret
      - token_secret
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

secrets:
  db_password:
    file: ./secrets/db_password.txt
  jwt_secret:
    file: ./secrets/jwt_secret.txt
  token_secret:
    file: ./secrets/token_secret.txt

volumes:
  postgres_data:
  redis_data:
```

---

## 📝 Useful Commands Cheat Sheet

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f

# Rebuild and start
docker-compose up -d --build

# Execute command in container
docker-compose exec api npm test

# Access shell in container
docker-compose exec api sh

# Check container status
docker-compose ps

# View resource usage
docker stats

# Clean up everything
docker-compose down -v
docker system prune -a
```

---

## ✅ Verification Checklist

- [ ] Docker Desktop installed and running
- [ ] docker-compose.yml created
- [ ] api/Dockerfile created
- [ ] .env file configured
- [ ] Containers started: `docker-compose up -d`
- [ ] Migrations run: `docker-compose exec api npm run migrate`
- [ ] Health check passing: `curl http://localhost:3000/health`
- [ ] Tests passing: `docker-compose exec api npm test`

---

## 🎉 Success!

Your OpenStream is now running in Docker containers!

**Access your API:** http://localhost:3000

**Next steps:**
1. Set up frontend application
2. Configure SRS streaming server
3. Set up NGINX reverse proxy (optional)
4. Configure domain and SSL (for production)

---

## 📚 Additional Resources

- Docker Desktop docs: https://docs.docker.com/desktop/
- Docker Compose docs: https://docs.docker.com/compose/
- PostgreSQL Docker: https://hub.docker.com/_/postgres
- Redis Docker: https://hub.docker.com/_/redis
