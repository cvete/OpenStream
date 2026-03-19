-- Migration: Fix missing tables from failed init
-- The original init.sql had MySQL-style INDEX syntax in playback_tokens
-- which caused PostgreSQL to stop, leaving later tables uncreated.

-- Recreate playback_tokens without inline INDEX syntax
CREATE TABLE IF NOT EXISTS playback_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id UUID REFERENCES streams(id) ON DELETE CASCADE,
    token VARCHAR(64) NOT NULL,
    viewer_ip VARCHAR(45),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_used BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create recordings table
CREATE TABLE IF NOT EXISTS recordings (
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

-- Create stream_stats table
CREATE TABLE IF NOT EXISTS stream_stats (
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

-- Create access_logs table
CREATE TABLE IF NOT EXISTS access_logs (
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

-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT,
    description VARCHAR(255),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
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

-- Create missing indexes (IF NOT EXISTS requires PG 9.5+)
CREATE INDEX IF NOT EXISTS idx_recordings_stream_id ON recordings(stream_id);
CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
CREATE INDEX IF NOT EXISTS idx_stream_stats_stream_id ON stream_stats(stream_id);
CREATE INDEX IF NOT EXISTS idx_stream_stats_timestamp ON stream_stats(timestamp);
CREATE INDEX IF NOT EXISTS idx_access_logs_stream_id ON access_logs(stream_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_access_logs_ip ON access_logs(ip_address);
CREATE INDEX IF NOT EXISTS idx_playback_tokens_token ON playback_tokens(token);
CREATE INDEX IF NOT EXISTS idx_playback_tokens_expires ON playback_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Insert default settings if not present
INSERT INTO settings (key, value, description) VALUES
('token_expiry_hours', '4', 'Playback token expiration time in hours'),
('max_viewers_per_stream', '5000', 'Maximum concurrent viewers per stream'),
('recording_enabled', 'true', 'Enable automatic recording'),
('transcoding_enabled', 'false', 'Enable ABR transcoding'),
('hotlink_protection', 'true', 'Enable hotlink protection'),
('domain_protection', 'true', 'Enable domain whitelist protection')
ON CONFLICT (key) DO NOTHING;

-- Insert default domains if not present
INSERT INTO global_domains (domain, description) VALUES
('localhost', 'Local development'),
('127.0.0.1', 'Local development')
ON CONFLICT (domain) DO NOTHING;

-- Create triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_recordings_updated_at') THEN
        CREATE TRIGGER update_recordings_updated_at BEFORE UPDATE ON recordings
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END
$$;

-- Token cleanup function
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
    DELETE FROM playback_tokens WHERE expires_at < NOW();
END;
$$ language 'plpgsql';
