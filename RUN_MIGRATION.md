# Database Migration Guide

## 🔄 New Migration: Audit Logs

A new database migration has been created as part of the production readiness implementation.

---

## Migration File
- **Location:** `api/database/migrations/003_audit_logs.sql`
- **Purpose:** Create audit logging table for tracking admin actions
- **Version:** 003
- **Date:** 2025-02-02

---

## What It Creates

### audit_logs Table
```sql
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    changes JSONB,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Indexes Created
- `idx_audit_logs_user_id` - Fast user lookup
- `idx_audit_logs_created_at` - Fast time-based queries
- `idx_audit_logs_action` - Fast action filtering
- `idx_audit_logs_resource` - Fast resource lookup

---

## How to Run Migration

### Option 1: Using Migration Script (Recommended)
```bash
cd api
npm run migrate
```

This will automatically apply all pending migrations.

### Option 2: Manual SQL Execution
```bash
# PostgreSQL
psql $DATABASE_URL -f database/migrations/003_audit_logs.sql

# Or if using local database
psql -U postgres -d streaming_db -f database/migrations/003_audit_logs.sql
```

---

## Verification

### Check if migration was successful:
```bash
# Connect to database
psql $DATABASE_URL

# List tables (should see audit_logs)
\dt

# Describe audit_logs table
\d audit_logs

# Check indexes
\di audit_logs*

# Exit
\q
```

### Expected Output:
```
Table "public.audit_logs"
   Column      |          Type          | Modifiers
---------------+------------------------+-----------
 id            | integer                | not null
 user_id       | integer                |
 action        | varchar(100)           | not null
 resource_type | varchar(50)            | not null
 resource_id   | varchar(255)           |
 ip_address    | inet                   |
 user_agent    | text                   |
 changes       | jsonb                  |
 metadata      | jsonb                  |
 created_at    | timestamp              |

Indexes:
    "audit_logs_pkey" PRIMARY KEY, btree (id)
    "idx_audit_logs_action" btree (action)
    "idx_audit_logs_created_at" btree (created_at DESC)
    "idx_audit_logs_resource" btree (resource_type, resource_id)
    "idx_audit_logs_user_id" btree (user_id)
```

---

## Test the Audit Logs

### 1. Start the API
```bash
npm run dev
```

### 2. Perform an action (e.g., login)
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'
```

### 3. Check audit logs (admin only)
```bash
# Get your auth token from login response, then:
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:3000/api/audit/recent
```

### 4. Verify in database
```bash
psql $DATABASE_URL -c "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 5;"
```

You should see audit log entries for the login action.

---

## Rollback (If Needed)

If you need to rollback this migration:

```sql
-- Drop audit_logs table
DROP TABLE IF EXISTS audit_logs CASCADE;
```

**Warning:** This will delete all audit log data. Only use for development/testing.

---

## Migration Status Tracking

After running migrations, you can check which have been applied:

```bash
# Check migrations table
psql $DATABASE_URL -c "SELECT * FROM schema_migrations ORDER BY version;"
```

Expected versions:
- 001 - Initial schema
- 002 - Performance indexes
- 003 - Audit logs (NEW)

---

## Common Issues

### Issue: "relation 'audit_logs' already exists"
**Solution:** Migration already applied. No action needed.

### Issue: "permission denied for relation audit_logs"
**Solution:** Grant permissions to your database user:
```sql
GRANT ALL PRIVILEGES ON TABLE audit_logs TO your_db_user;
GRANT USAGE, SELECT ON SEQUENCE audit_logs_id_seq TO your_db_user;
```

### Issue: "column 'user_id' referenced in foreign key constraint does not exist"
**Solution:** Ensure previous migrations (001, 002) have been run first.

---

## Production Deployment

### Before Deploying:
1. **Backup production database:**
   ```bash
   pg_dump $PRODUCTION_DATABASE_URL > backup_$(date +%Y%m%d).sql
   ```

2. **Test migration on staging first**

3. **Schedule maintenance window** (migration is fast but safer with window)

### Deploying to Production:
```bash
# 1. SSH into production server
ssh user@production-server

# 2. Navigate to application directory
cd /path/to/openstream/api

# 3. Run migration
NODE_ENV=production npm run migrate

# 4. Verify
psql $PRODUCTION_DATABASE_URL -c "\d audit_logs"

# 5. Restart API
pm2 restart openstream-api
# or
systemctl restart openstream-api
```

### Post-Deployment Verification:
```bash
# Check API health
curl https://your-domain.com/health

# Trigger a test audit log (login as admin)
curl -X POST https://your-domain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'

# Verify audit log was created
curl -H "Authorization: Bearer $TOKEN" \
     https://your-domain.com/api/audit/recent
```

---

## Migration Checklist

- [ ] Backup database
- [ ] Run migration on development
- [ ] Verify migration successful
- [ ] Test audit logging locally
- [ ] Run migration on staging (if applicable)
- [ ] Test audit logging on staging
- [ ] Schedule production deployment window
- [ ] Backup production database
- [ ] Run migration on production
- [ ] Verify migration successful in production
- [ ] Test audit logging in production
- [ ] Monitor for errors

---

## Next Steps

After successfully running the migration:

1. ✅ Audit logs table is ready
2. ✅ API will automatically use audit logging
3. ✅ Admin actions will be tracked
4. ✅ View logs via `/api/audit` endpoints

The audit logging system is now active and will track:
- User logins
- Stream creation/deletion
- Domain changes
- Settings updates
- All other admin actions

---

## Support

If you encounter issues with the migration:
1. Check the error message carefully
2. Verify database connection
3. Ensure you have proper permissions
4. Review previous migrations are applied
5. Check PostgreSQL logs for detailed errors

**Migration file location:**
`api/database/migrations/003_audit_logs.sql`

**Database service file:**
`api/src/services/database.js`

**Audit logger service:**
`api/src/services/auditLogger.js`
