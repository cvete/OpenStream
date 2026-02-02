-- Migration: Audit Logging System
-- Description: Create audit log table to track admin actions and critical events
-- Date: 2025-02-02

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id VARCHAR(255),
    ip_address INET,
    user_agent TEXT,
    changes JSONB,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

-- Add comments for documentation
COMMENT ON TABLE audit_logs IS 'Audit trail for tracking admin actions and critical system events';
COMMENT ON COLUMN audit_logs.action IS 'Action performed (e.g., stream.create, stream.delete, user.update)';
COMMENT ON COLUMN audit_logs.resource_type IS 'Type of resource affected (e.g., stream, user, domain)';
COMMENT ON COLUMN audit_logs.resource_id IS 'ID of the resource affected';
COMMENT ON COLUMN audit_logs.changes IS 'JSON object containing before/after values for updates';
COMMENT ON COLUMN audit_logs.metadata IS 'Additional context data for the audit event';
