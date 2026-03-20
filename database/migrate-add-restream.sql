-- Migration: Add restream columns to streams table
ALTER TABLE streams ADD COLUMN IF NOT EXISTS restream_source_url TEXT;
ALTER TABLE streams ADD COLUMN IF NOT EXISTS restream_status VARCHAR(20) DEFAULT NULL;
ALTER TABLE streams ADD COLUMN IF NOT EXISTS restream_error TEXT;
