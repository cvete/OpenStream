-- Performance optimization indexes for OpenStream
-- Run this migration to add critical indexes for production

-- Streams table indexes
CREATE INDEX IF NOT EXISTS idx_streams_stream_key ON streams(stream_key);
CREATE INDEX IF NOT EXISTS idx_streams_user_id ON streams(user_id);
CREATE INDEX IF NOT EXISTS idx_streams_status ON streams(status) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_streams_created_at ON streams(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_streams_is_active ON streams(is_active);

-- Recordings table indexes
CREATE INDEX IF NOT EXISTS idx_recordings_stream_id ON recordings(stream_id);
CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
CREATE INDEX IF NOT EXISTS idx_recordings_recorded_at ON recordings(recorded_at DESC);

-- Stream stats table indexes
CREATE INDEX IF NOT EXISTS idx_stream_stats_stream_id ON stream_stats(stream_id);
CREATE INDEX IF NOT EXISTS idx_stream_stats_timestamp ON stream_stats(timestamp DESC);

-- Access logs table indexes (if exists)
CREATE INDEX IF NOT EXISTS idx_access_logs_created_at ON access_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_logs_is_allowed ON access_logs(is_allowed);

-- Domain whitelist indexes (if exists)
CREATE INDEX IF NOT EXISTS idx_global_domains_domain ON global_domains(domain);
CREATE INDEX IF NOT EXISTS idx_stream_domains_stream_id ON stream_domains(stream_id);

-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Output success message
DO $$
BEGIN
    RAISE NOTICE 'All performance indexes created successfully';
END $$;
