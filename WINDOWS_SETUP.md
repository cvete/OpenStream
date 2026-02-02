# OpenStream - Native Windows Setup Guide

## 💻 Running OpenStream Natively on Windows

This guide will help you install and run OpenStream directly on Windows without Docker.

---

## Prerequisites

### 1. Node.js (Required)
- **Download:** https://nodejs.org/
- **Version:** 18.x or higher
- **Installation:** Download and run the installer
- **Verify:**
  ```bash
  node --version  # Should show v18.x.x or higher
  npm --version   # Should show 9.x.x or higher
  ```

### 2. PostgreSQL (Required)
- **Download:** https://www.postgresql.org/download/windows/
- **Version:** 15.x recommended
- **Installation:**
  1. Run the installer
  2. Remember the password you set for the `postgres` user
  3. Keep default port: 5432
  4. Install pgAdmin (optional but helpful)

- **Verify:**
  ```bash
  psql --version  # Should show PostgreSQL 15.x
  ```

### 3. Redis (Required)
- **Download:** https://github.com/microsoftarchive/redis/releases
- **Version:** Latest (5.0.14 for Windows)
- **Installation:**
  1. Download Redis-x64-5.0.14.zip
  2. Extract to `C:\Redis`
  3. Open Command Prompt as Administrator
  4. Run:
     ```bash
     cd C:\Redis
     redis-server --service-install redis.windows.conf
     redis-server --service-start
     ```

- **Verify:**
  ```bash
  redis-cli ping  # Should return PONG
  ```

### 4. Git (Optional but Recommended)
- **Download:** https://git-scm.com/download/win
- **Installation:** Run installer with default options

---

## 🚀 Installation Steps

### Step 1: Navigate to Project Directory

```bash
cd C:\Users\cvete_ktnaen7\Desktop\Projects\OpenStream\api
```

### Step 2: Install Dependencies

```bash
npm install
```

This will install all required packages (may take 2-3 minutes).

### Step 3: Set Up PostgreSQL Database

**Option A: Using psql Command Line**
```bash
# Open Command Prompt and run:
psql -U postgres

# Inside PostgreSQL prompt:
CREATE DATABASE streaming_db;
CREATE USER streaming WITH PASSWORD 'streaming_password';
GRANT ALL PRIVILEGES ON DATABASE streaming_db TO streaming;
\q
```

**Option B: Using pgAdmin**
1. Open pgAdmin
2. Connect to PostgreSQL server
3. Right-click "Databases" → Create → Database
4. Name: `streaming_db`
5. Owner: `postgres`
6. Click "Save"

### Step 4: Configure Environment Variables

Create `.env` file in `api` folder:

```bash
cd C:\Users\cvete_ktnaen7\Desktop\Projects\OpenStream\api
notepad .env
```

Add the following content:

```env
# Server Configuration
NODE_ENV=development
PORT=3000

# Database Configuration
DATABASE_URL=postgresql://streaming:streaming_password@localhost:5432/streaming_db

# Redis Configuration
REDIS_URL=redis://localhost:6379

# JWT Configuration (CHANGE THESE IN PRODUCTION!)
JWT_SECRET=your-secure-jwt-secret-minimum-32-characters-required-here
JWT_EXPIRES_IN=24h
JWT_REFRESH_EXPIRES_IN=7d

# Token Configuration
TOKEN_SECRET=your-secure-token-secret-minimum-32-characters-required-here
TOKEN_EXPIRY_HOURS=4

# CORS Configuration (Add your frontend URLs)
ALLOWED_ORIGINS=http://localhost:3001,http://localhost:5173

# SRS Configuration (Optional - for streaming server)
SRS_API_URL=http://localhost:1985
SRS_RTMP_PORT=1935

# Sentry Configuration (Optional - for error tracking)
SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.1

# Media Paths
MEDIA_PATH=C:\OpenStream\media
MEDIA_LIVE_PATH=C:\OpenStream\media\live
MEDIA_VOD_PATH=C:\OpenStream\media\vod
```

**Important:** Change the JWT_SECRET and TOKEN_SECRET to secure random strings!

### Step 5: Generate Secure Secrets

**Option A: Using Node.js**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Option B: Using PowerShell**
```powershell
[System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

Copy the generated strings and paste them into your `.env` file for JWT_SECRET and TOKEN_SECRET.

### Step 6: Create Media Directories

```bash
mkdir C:\OpenStream\media
mkdir C:\OpenStream\media\live
mkdir C:\OpenStream\media\vod
```

### Step 7: Run Database Migrations

```bash
npm run migrate
```

Expected output:
```
✅ Production configuration validated
Running database migrations...
Migration 001_initial_schema.sql completed
Migration 002_add_indexes.sql completed
Migration 003_audit_logs.sql completed
✅ All migrations completed successfully
```

### Step 8: Start the Server

**Development Mode (with auto-reload):**
```bash
npm run dev
```

**Production Mode:**
```bash
npm start
```

Expected output:
```
Streaming API server running on port 3000
Environment: development
Database connected
Redis connected
```

### Step 9: Verify Installation

Open another Command Prompt and test:

```bash
# Health check
curl http://localhost:3000/health

# Should return:
# {"status":"healthy","timestamp":"...","uptime":...}
```

---

## 🧪 Running Tests

```bash
# Run all tests
npm test

# Run unit tests only
npm run test:unit

# Run integration tests
npm run test:integration

# Generate coverage report
npm run test:coverage
```

---

## 🔧 Windows-Specific Configuration

### Running as Windows Service (Production)

**Using PM2:**

1. **Install PM2 globally:**
   ```bash
   npm install -g pm2
   ```

2. **Start application with PM2:**
   ```bash
   cd C:\Users\cvete_ktnaen7\Desktop\Projects\OpenStream\api
   pm2 start src/index.js --name openstream-api
   ```

3. **Set up PM2 to start on boot:**
   ```bash
   pm2 startup
   pm2 save
   ```

4. **PM2 Management Commands:**
   ```bash
   pm2 list              # List all apps
   pm2 logs openstream-api  # View logs
   pm2 restart openstream-api
   pm2 stop openstream-api
   pm2 delete openstream-api
   pm2 monit             # Monitor resources
   ```

**Using NSSM (Non-Sucking Service Manager):**

1. **Download NSSM:**
   - https://nssm.cc/download

2. **Install as service:**
   ```bash
   nssm install OpenStreamAPI
   # Path: C:\Program Files\nodejs\node.exe
   # Startup directory: C:\Users\cvete_ktnaen7\Desktop\Projects\OpenStream\api
   # Arguments: src/index.js
   ```

3. **Manage service:**
   ```bash
   nssm start OpenStreamAPI
   nssm stop OpenStreamAPI
   nssm restart OpenStreamAPI
   nssm remove OpenStreamAPI
   ```

---

## 🛠️ Troubleshooting

### PostgreSQL Connection Issues

**Error: "password authentication failed"**
```bash
# Reset PostgreSQL password
psql -U postgres
ALTER USER streaming WITH PASSWORD 'streaming_password';
\q
```

**Error: "could not connect to server"**
```bash
# Check if PostgreSQL is running
# Open Services (services.msc)
# Look for "postgresql-x64-15" service
# Right-click -> Start
```

**Check PostgreSQL is listening:**
```bash
netstat -an | findstr :5432
```

### Redis Connection Issues

**Error: "Redis connection refused"**
```bash
# Check if Redis is running
redis-cli ping

# If not running, start it:
cd C:\Redis
redis-server redis.windows.conf

# Or start as service:
redis-server --service-start
```

**Check Redis service:**
```bash
# Open Services (services.msc)
# Look for "Redis" service
# Right-click -> Start
```

### Port Already in Use

**Error: "Port 3000 is already in use"**
```bash
# Find what's using the port
netstat -ano | findstr :3000

# Kill the process (replace PID with actual number)
taskkill /PID <PID> /F

# Or change port in .env file
PORT=3001
```

### Module Not Found Errors

```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and reinstall
rmdir /s /q node_modules
del package-lock.json
npm install
```

### Migration Errors

**Error: "relation does not exist"**
```bash
# Drop and recreate database
psql -U postgres
DROP DATABASE streaming_db;
CREATE DATABASE streaming_db;
\q

# Run migrations again
npm run migrate
```

### Windows Firewall Issues

```bash
# Allow Node.js through firewall
# Open Windows Defender Firewall
# Advanced Settings -> Inbound Rules -> New Rule
# Program: C:\Program Files\nodejs\node.exe
# Allow the connection
```

---

## 📊 Database Management on Windows

### Using pgAdmin

1. **Open pgAdmin**
2. **Connect to Server**
3. **Navigate to:** Servers → PostgreSQL 15 → Databases → streaming_db

**Useful pgAdmin Features:**
- Query Tool: Run SQL queries
- Backup: Right-click database → Backup
- Restore: Right-click database → Restore
- View tables: Schemas → public → Tables

### Using Command Line

```bash
# Connect to database
psql -U streaming -d streaming_db

# Common commands
\dt              # List tables
\d streams       # Describe table
\l               # List databases
\du              # List users
\q               # Exit

# Backup database
pg_dump -U streaming streaming_db > backup.sql

# Restore database
psql -U streaming -d streaming_db < backup.sql
```

---

## 🔄 Updates and Maintenance

### Updating Dependencies

```bash
# Check for outdated packages
npm outdated

# Update packages
npm update

# Update major versions (carefully)
npm install package-name@latest
```

### Pulling Latest Code

```bash
cd C:\Users\cvete_ktnaen7\Desktop\Projects\OpenStream
git pull origin main

cd api
npm install
npm run migrate
npm test
pm2 restart openstream-api  # If using PM2
```

---

## 🌐 Accessing from Other Devices on Network

### Allow Network Access

1. **Update .env:**
   ```env
   # Change from localhost to 0.0.0.0
   # This allows connections from any IP
   ```

2. **Add your IP to ALLOWED_ORIGINS:**
   ```env
   ALLOWED_ORIGINS=http://localhost:3001,http://192.168.1.100:3001
   ```

3. **Get your local IP:**
   ```bash
   ipconfig
   # Look for "IPv4 Address"
   ```

4. **Access from other device:**
   ```
   http://YOUR_IP:3000
   ```

---

## 📝 Startup Checklist

Every time you start working:

```bash
# 1. Check PostgreSQL is running
net start postgresql-x64-15

# 2. Check Redis is running
redis-cli ping

# 3. Navigate to project
cd C:\Users\cvete_ktnaen7\Desktop\Projects\OpenStream\api

# 4. Start development server
npm run dev
```

---

## 🚀 Production Deployment on Windows

### Using IIS (Advanced)

1. **Install iisnode:**
   - https://github.com/Azure/iisnode

2. **Configure web.config:**
   ```xml
   <configuration>
     <system.webServer>
       <handlers>
         <add name="iisnode" path="src/index.js" verb="*" modules="iisnode"/>
       </handlers>
       <rewrite>
         <rules>
           <rule name="NodeInspector" patternSyntax="ECMAScript" stopProcessing="true">
             <match url="^src/index.js\/debug[\/]?" />
           </rule>
           <rule name="StaticContent">
             <action type="Rewrite" url="public{REQUEST_URI}"/>
           </rule>
           <rule name="DynamicContent">
             <conditions>
               <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="True"/>
             </conditions>
             <action type="Rewrite" url="src/index.js"/>
           </rule>
         </rules>
       </rewrite>
     </system.webServer>
   </configuration>
   ```

---

## ✅ Verification Checklist

- [ ] Node.js 18+ installed
- [ ] PostgreSQL 15+ installed and running
- [ ] Redis installed and running
- [ ] Dependencies installed (`npm install`)
- [ ] .env file created and configured
- [ ] Secrets generated (JWT_SECRET, TOKEN_SECRET)
- [ ] Media directories created
- [ ] Database migrations run
- [ ] Server starts successfully
- [ ] Health check passes
- [ ] Tests pass

---

## 🎉 Success!

Your OpenStream API is now running natively on Windows!

**API URL:** http://localhost:3000
**Health Check:** http://localhost:3000/health

**Useful Commands:**
```bash
npm run dev      # Start development server
npm start        # Start production server
npm test         # Run tests
npm run migrate  # Run database migrations
```

---

## 📚 Additional Resources

- Node.js docs: https://nodejs.org/docs/
- PostgreSQL Windows docs: https://www.postgresql.org/docs/15/install-windows.html
- Redis Windows: https://github.com/microsoftarchive/redis
- PM2 docs: https://pm2.keymetrics.io/docs/usage/quick-start/
