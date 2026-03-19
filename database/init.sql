-- Streaming Server Database Schema
-- PostgreSQL 15+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Users table (admin accounts)
-- ============================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('admin', 'user', 'viewer')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE
);

-- ============================================
-- Streams table
-- ============================================
CREATE TABLE streams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    stream_key VARCHAR(50) UNIQUE NOT NULL,
    description TEXT,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'offline' CHECK (status IN ('offline', 'live', 'ended')),
    is_active BOOLEAN DEFAULT true,
    is_recording_enabled BOOLEAN DEFAULT true,
    is_transcoding_enabled BOOLEAN DEFAULT false,
    max_viewers INTEGER DEFAULT 0,
    current_viewers INTEGER DEFAULT 0,
    total_views INTEGER DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE,
    ended_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Stream allowed domains (for hotlink protection)
-- ============================================
CREATE TABLE stream_domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id UUID REFERENCES streams(id) ON DELETE CASCADE,
    domain VARCHAR(255) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(stream_id, domain)
);

-- ============================================
-- Global allowed domains (apply to all streams)
-- ============================================
CREATE TABLE global_domains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain VARCHAR(255) UNIQUE NOT NULL,
    description VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Playback tokens (for secure access)
-- ============================================
CREATE TABLE playback_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id UUID REFERENCES streams(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL,
    viewer_ip VARCHAR(45),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_used BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- VOD recordings
-- ============================================
CREATE TABLE recordings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id UUID REFERENCES streams(id) ON DELETE SET NULL,
    stream_name VARCHAR(255),
    file_path VARCHAR(500) NOT NULL,
    file_size BIGINT DEFAULT 0,
    duration INTEGER DEFAULT 0,
    format VARCHAR(20) DEFAULT 'flv',
    status VARCHAR(20) DEFAULT 'recording' CHECK (status IN ('recording', 'completed', 'processing', 'ready', 'failed', 'deleted')),
    thumbnail_path VARCHAR(500),
    hls_path VARCHAR(500),
    views INTEGER DEFAULT 0,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Stream statistics (aggregated)
-- ============================================
CREATE TABLE stream_stats (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id UUID REFERENCES streams(id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    viewers INTEGER DEFAULT 0,
    bandwidth_in BIGINT DEFAULT 0,
    bandwidth_out BIGINT DEFAULT 0,
    bitrate INTEGER DEFAULT 0,
    fps DECIMAL(5,2) DEFAULT 0,
    width INTEGER DEFAULT 0,
    height INTEGER DEFAULT 0
);

-- ============================================
-- Access logs (for security monitoring)
-- ============================================
CREATE TABLE access_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id UUID REFERENCES streams(id) ON DELETE SET NULL,
    action VARCHAR(50) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    referer TEXT,
    country VARCHAR(2),
    is_allowed BOOLEAN DEFAULT true,
    reason VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Server settings
-- ============================================
CREATE TABLE settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    description VARCHAR(255),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Audit logs
-- ============================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    changes JSONB,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Indexes for performance
-- ============================================
CREATE INDEX idx_streams_stream_key ON streams(stream_key);
CREATE INDEX idx_streams_status ON streams(status);
CREATE INDEX idx_streams_user_id ON streams(user_id);
CREATE INDEX idx_stream_domains_stream_id ON stream_domains(stream_id);
CREATE INDEX idx_stream_domains_domain ON stream_domains(domain);
CREATE INDEX idx_recordings_stream_id ON recordings(stream_id);
CREATE INDEX idx_recordings_status ON recordings(status);
CREATE INDEX idx_stream_stats_stream_id ON stream_stats(stream_id);
CREATE INDEX idx_stream_stats_timestamp ON stream_stats(timestamp);
CREATE INDEX idx_access_logs_stream_id ON access_logs(stream_id);
CREATE INDEX idx_access_logs_created_at ON access_logs(created_at);
CREATE INDEX idx_access_logs_ip ON access_logs(ip_address);
CREATE INDEX idx_playback_tokens_token ON playback_tokens(token);
CREATE INDEX idx_playback_tokens_expires ON playback_tokens(expires_at);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);

-- ============================================
-- Default data
-- ============================================

-- NOTE: Admin user must be created after deployment using:
--   npm run create-admin -- --username <user> --email <email> --password <pass>

-- Default global allowed domains
INSERT INTO global_domains (domain, description) VALUES
('localhost', 'Local development'),
('127.0.0.1', 'Local development');

-- Default settings
INSERT INTO settings (key, value, description) VALUES
('token_expiry_hours', '4', 'Playback token expiration time in hours'),
('max_viewers_per_stream', '5000', 'Maximum concurrent viewers per stream'),
('recording_enabled', 'true', 'Enable automatic recording'),
('transcoding_enabled', 'false', 'Enable ABR transcoding'),
('hotlink_protection', 'true', 'Enable hotlink protection'),
('domain_protection', 'true', 'Enable domain whitelist protection');

-- ============================================
-- Functions and Triggers
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to tables with updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_streams_updated_at BEFORE UPDATE ON streams
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_recordings_updated_at BEFORE UPDATE ON recordings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to clean up expired tokens (run periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
    DELETE FROM playback_tokens WHERE expires_at < NOW();
END;
$$ language 'plpgsql';
