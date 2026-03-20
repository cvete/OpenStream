-- Migration: Add transcoding support
-- Run: docker exec -i streaming-postgres psql -U streaming -d streaming_db < database/migrate-add-transcoding.sql

-- Transcoding profiles table (quality presets)
CREATE TABLE IF NOT EXISTS transcoding_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    video_bitrate INTEGER NOT NULL,
    audio_bitrate INTEGER NOT NULL DEFAULT 128,
    fps INTEGER NOT NULL DEFAULT 30,
    video_codec VARCHAR(20) DEFAULT 'libx264',
    video_profile VARCHAR(20) DEFAULT 'main',
    preset VARCHAR(20) DEFAULT 'medium',
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Per-stream profile assignments
CREATE TABLE IF NOT EXISTS stream_transcoding_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    stream_id UUID REFERENCES streams(id) ON DELETE CASCADE,
    profile_id UUID REFERENCES transcoding_profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(stream_id, profile_id)
);

-- Add transcoding status columns to streams table
ALTER TABLE streams ADD COLUMN IF NOT EXISTS transcoding_status VARCHAR(20) DEFAULT NULL;
ALTER TABLE streams ADD COLUMN IF NOT EXISTS transcoding_error TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_transcoding_profiles_active ON transcoding_profiles(is_active);
CREATE INDEX IF NOT EXISTS idx_stream_tc_profiles_stream ON stream_transcoding_profiles(stream_id);

-- Default profiles
INSERT INTO transcoding_profiles (name, display_name, width, height, video_bitrate, audio_bitrate, fps, video_profile, preset, sort_order) VALUES
('1080p', '1080p Full HD', 1920, 1080, 4500, 128, 30, 'high', 'medium', 1),
('720p',  '720p HD',       1280, 720,  2500, 128, 30, 'main', 'medium', 2),
('480p',  '480p SD',       854,  480,  1200, 96,  30, 'main', 'fast',   3),
('360p',  '360p Low',      640,  360,  600,  64,  25, 'baseline', 'fast', 4)
ON CONFLICT (name) DO NOTHING;

-- Trigger for updated_at
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_transcoding_profiles_updated_at') THEN
        CREATE TRIGGER update_transcoding_profiles_updated_at BEFORE UPDATE ON transcoding_profiles
            FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Settings
INSERT INTO settings (key, value, description) VALUES
('max_concurrent_transcodes', '5', 'Max streams transcoding simultaneously'),
('default_transcoding_profiles', '720p,480p,360p', 'Default profiles for new streams')
ON CONFLICT (key) DO NOTHING;
