/**
 * Transcoding Routes
 * Manages transcoding profiles and global transcoding status
 */

const express = require('express');
const router = express.Router();
const db = require('../services/database');
const logger = require('../services/logger');
const { verifyToken } = require('../middleware/auth');
const transcoderManager = require('../services/transcoderManager');

// All routes require authentication
router.use(verifyToken);

// ============================================
// Profile CRUD
// ============================================

/**
 * GET /api/transcoding/profiles - List all transcoding profiles
 */
router.get('/profiles', async (req, res) => {
    try {
        const activeOnly = req.query.active === 'true';
        let query = 'SELECT * FROM transcoding_profiles';
        const params = [];

        if (activeOnly) {
            query += ' WHERE is_active = true';
        }
        query += ' ORDER BY sort_order, name';

        const result = await db.query(query, params);
        res.json({ profiles: result.rows });
    } catch (error) {
        logger.error('Failed to list transcoding profiles:', error);
        res.status(500).json({ error: 'Failed to list profiles' });
    }
});

/**
 * POST /api/transcoding/profiles - Create a new profile
 */
router.post('/profiles', async (req, res) => {
    try {
        const { name, display_name, width, height, video_bitrate, audio_bitrate, fps, video_codec, video_profile, preset, sort_order } = req.body;

        if (!name || !display_name || !width || !height || !video_bitrate) {
            return res.status(400).json({ error: 'name, display_name, width, height, and video_bitrate are required' });
        }

        const result = await db.query(
            `INSERT INTO transcoding_profiles (name, display_name, width, height, video_bitrate, audio_bitrate, fps, video_codec, video_profile, preset, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [name, display_name, width, height, video_bitrate, audio_bitrate || 128, fps || 30, video_codec || 'libx264', video_profile || 'main', preset || 'medium', sort_order || 0]
        );

        res.status(201).json({ profile: result.rows[0] });
    } catch (error) {
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Profile name already exists' });
        }
        logger.error('Failed to create transcoding profile:', error);
        res.status(500).json({ error: 'Failed to create profile' });
    }
});

/**
 * PUT /api/transcoding/profiles/:id - Update a profile
 */
router.put('/profiles/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const allowedFields = ['name', 'display_name', 'width', 'height', 'video_bitrate', 'audio_bitrate', 'fps', 'video_codec', 'video_profile', 'preset', 'sort_order', 'is_active'];

        const updates = [];
        const values = [];
        let paramCount = 1;

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates.push(`${field} = $${paramCount}`);
                values.push(req.body[field]);
                paramCount++;
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        values.push(id);
        const result = await db.query(
            `UPDATE transcoding_profiles SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        res.json({ profile: result.rows[0] });
    } catch (error) {
        logger.error('Failed to update transcoding profile:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

/**
 * DELETE /api/transcoding/profiles/:id - Deactivate a profile
 */
router.delete('/profiles/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            `UPDATE transcoding_profiles SET is_active = false WHERE id = $1 RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Profile not found' });
        }

        res.json({ message: 'Profile deactivated', profile: result.rows[0] });
    } catch (error) {
        logger.error('Failed to deactivate transcoding profile:', error);
        res.status(500).json({ error: 'Failed to deactivate profile' });
    }
});

// ============================================
// Stream-specific profile assignments
// ============================================

/**
 * GET /api/transcoding/streams/:id/profiles - Get profiles assigned to a stream
 */
router.get('/streams/:id/profiles', async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            `SELECT tp.* FROM transcoding_profiles tp
             JOIN stream_transcoding_profiles stp ON tp.id = stp.profile_id
             WHERE stp.stream_id = $1 AND tp.is_active = true
             ORDER BY tp.sort_order`,
            [id]
        );

        res.json({ profiles: result.rows, using_defaults: result.rows.length === 0 });
    } catch (error) {
        logger.error('Failed to get stream transcoding profiles:', error);
        res.status(500).json({ error: 'Failed to get profiles' });
    }
});

/**
 * PUT /api/transcoding/streams/:id/profiles - Assign profiles to a stream
 */
router.put('/streams/:id/profiles', async (req, res) => {
    try {
        const { id } = req.params;
        const { profile_ids, profile_names } = req.body;

        // Resolve profile IDs from names if needed
        let ids = profile_ids;
        if (!ids && profile_names) {
            const result = await db.query(
                `SELECT id FROM transcoding_profiles WHERE name = ANY($1) AND is_active = true`,
                [profile_names]
            );
            ids = result.rows.map(r => r.id);
        }

        if (!ids || ids.length === 0) {
            // Clear all assignments (use defaults)
            await db.query('DELETE FROM stream_transcoding_profiles WHERE stream_id = $1', [id]);
            return res.json({ profiles: [], using_defaults: true });
        }

        // Replace all assignments in a transaction
        await db.transaction(async (client) => {
            await client.query('DELETE FROM stream_transcoding_profiles WHERE stream_id = $1', [id]);
            for (const profileId of ids) {
                await client.query(
                    'INSERT INTO stream_transcoding_profiles (stream_id, profile_id) VALUES ($1, $2)',
                    [id, profileId]
                );
            }
        });

        // Return updated assignments
        const result = await db.query(
            `SELECT tp.* FROM transcoding_profiles tp
             JOIN stream_transcoding_profiles stp ON tp.id = stp.profile_id
             WHERE stp.stream_id = $1 AND tp.is_active = true
             ORDER BY tp.sort_order`,
            [id]
        );

        res.json({ profiles: result.rows, using_defaults: false });
    } catch (error) {
        logger.error('Failed to assign transcoding profiles:', error);
        res.status(500).json({ error: 'Failed to assign profiles' });
    }
});

// ============================================
// Global transcoding status
// ============================================

/**
 * GET /api/transcoding/status - Global transcoding status
 */
router.get('/status', async (req, res) => {
    try {
        const activeCount = transcoderManager.getActiveCount();
        const allStatuses = transcoderManager.getAllStatuses();

        // Get max concurrent from settings
        const settingResult = await db.query(
            "SELECT value FROM settings WHERE key = 'max_concurrent_transcodes'"
        );
        const maxConcurrent = parseInt(settingResult.rows[0]?.value) || 5;

        // Count total active profiles
        const totalProfiles = await db.query(
            'SELECT COUNT(*) as count FROM transcoding_profiles WHERE is_active = true'
        );

        res.json({
            active_transcodes: activeCount,
            max_concurrent: maxConcurrent,
            total_profiles: parseInt(totalProfiles.rows[0].count),
            sessions: allStatuses
        });
    } catch (error) {
        logger.error('Failed to get transcoding status:', error);
        res.status(500).json({ error: 'Failed to get status' });
    }
});

module.exports = router;
