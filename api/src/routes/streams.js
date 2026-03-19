/**
 * Streams Management Routes
 */

const express = require('express');
const router = express.Router();

const db = require('../services/database');
const redis = require('../services/redis');
const logger = require('../services/logger');
const auditLogger = require('../services/auditLogger');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const tokenService = require('../services/tokenService');
const { body, validationResult } = require('express-validator');
const {
    handleValidationErrors,
    validatePagination,
    validateStreamId,
    validateStreamName,
    validateStreamDescription,
    validateEnum
} = require('../middleware/validation');

/**
 * GET /api/streams
 * List all streams
 */
router.get('/',
    verifyToken,
    validatePagination(),
    validateEnum('status', ['offline', 'live', 'error'], 'query'),
    handleValidationErrors,
    async (req, res) => {
        try {
            const { status, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        let query = `
            SELECT s.*, u.username as owner_username
            FROM streams s
            LEFT JOIN users u ON s.user_id = u.id
            WHERE s.is_active = true
        `;
        const params = [];

        if (status) {
            params.push(status);
            query += ` AND s.status = $${params.length}`;
        }

        query += ` ORDER BY s.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await db.query(query, params);

        // Get viewer counts from Redis in batch (fixes N+1 query problem)
        const streamKeys = result.rows.map(s => s.stream_key);
        const viewerCounts = await redis.getViewerCountsBatch(streamKeys);

        const streams = result.rows.map(stream => ({
            ...stream,
            current_viewers: viewerCounts[stream.stream_key] || 0
        }));

        // Get total count
        const countResult = await db.query(
            `SELECT COUNT(*) FROM streams WHERE is_active = true ${status ? 'AND status = $1' : ''}`,
            status ? [status] : []
        );

        res.json({
            streams,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: parseInt(countResult.rows[0].count),
                totalPages: Math.ceil(countResult.rows[0].count / limit)
            }
        });

    } catch (error) {
        logger.error('Error listing streams:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to list streams'
        });
    }
});

/**
 * POST /api/streams
 * Create a new stream
 */
router.post('/',
    verifyToken,
    validateStreamName(),
    validateStreamDescription(),
    handleValidationErrors,
    async (req, res) => {
        try {
            const { name, description } = req.body;

        // Generate unique stream key
        const streamKey = tokenService.generateStreamKey();

        const result = await db.query(
            `INSERT INTO streams (name, stream_key, description, user_id)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [name, streamKey, description, req.user.id]
        );

        logger.info(`Stream created: ${name} (${streamKey}) by ${req.user.username}`);

        // Log audit trail
        await auditLogger.logAudit(
            req.user.id,
            'stream.create',
            'stream',
            result.rows[0].id.toString(),
            { stream_key: streamKey, name },
            req
        );

        res.status(201).json({
            message: 'Stream created successfully',
            stream: result.rows[0],
            rtmpUrl: `rtmp://your-server/live/${streamKey}`
        });

    } catch (error) {
        logger.error('Error creating stream:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to create stream'
        });
    }
});

/**
 * GET /api/streams/:id
 * Get stream details
 */
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Support both UUID and stream_key
        const result = await db.query(
            `SELECT s.*, u.username as owner_username
             FROM streams s
             LEFT JOIN users u ON s.user_id = u.id
             WHERE (s.id::text = $1 OR s.stream_key = $1) AND s.is_active = true`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Stream not found'
            });
        }

        const stream = result.rows[0];

        // Get viewer count from Redis
        stream.current_viewers = await redis.getViewerCount(stream.stream_key);

        // Get recent stats
        const statsResult = await db.query(
            `SELECT * FROM stream_stats
             WHERE stream_id = $1
             ORDER BY timestamp DESC
             LIMIT 1`,
            [stream.id]
        );

        if (statsResult.rows.length > 0) {
            stream.latest_stats = statsResult.rows[0];
        }

        res.json(stream);

    } catch (error) {
        logger.error('Error getting stream:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get stream'
        });
    }
});

/**
 * PUT /api/streams/:id
 * Update stream
 */
router.put('/:id', verifyToken, [
    body('name').optional().trim().notEmpty(),
    body('description').optional().trim(),
    body('is_recording_enabled').optional().isBoolean(),
    body('is_transcoding_enabled').optional().isBoolean()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const { id } = req.params;
        const updates = req.body;

        // Build update query dynamically
        const allowedFields = ['name', 'description', 'is_recording_enabled', 'is_transcoding_enabled'];
        const setClauses = [];
        const values = [];
        let paramIndex = 1;

        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                setClauses.push(`${field} = $${paramIndex}`);
                values.push(updates[field]);
                paramIndex++;
            }
        }

        if (setClauses.length === 0) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'No valid fields to update'
            });
        }

        values.push(id);

        const result = await db.query(
            `UPDATE streams SET ${setClauses.join(', ')}
             WHERE (id::text = $${paramIndex} OR stream_key = $${paramIndex}) AND is_active = true
             RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Stream not found'
            });
        }

        logger.info(`Stream updated: ${result.rows[0].stream_key} by ${req.user.username}`);

        res.json({
            message: 'Stream updated successfully',
            stream: result.rows[0]
        });

    } catch (error) {
        logger.error('Error updating stream:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to update stream'
        });
    }
});

/**
 * DELETE /api/streams/:id
 * Delete stream (soft delete)
 */
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            `UPDATE streams SET is_active = false
             WHERE (id::text = $1 OR stream_key = $1) AND is_active = true
             RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Stream not found'
            });
        }

        // Clean up Redis
        await redis.setStreamOffline(result.rows[0].stream_key);

        logger.info(`Stream deleted: ${result.rows[0].stream_key} by ${req.user.username}`);

        res.json({
            message: 'Stream deleted successfully'
        });

    } catch (error) {
        logger.error('Error deleting stream:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to delete stream'
        });
    }
});

/**
 * POST /api/streams/:id/stop
 * Force stop a live stream
 */
router.post('/:id/stop', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Get stream
        const streamResult = await db.query(
            `SELECT * FROM streams
             WHERE (id::text = $1 OR stream_key = $1) AND is_active = true`,
            [id]
        );

        if (streamResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Stream not found'
            });
        }

        const stream = streamResult.rows[0];

        // TODO: Call SRS API to kick the stream
        // This requires SRS HTTP API integration

        // Update stream status
        await db.query(
            `UPDATE streams SET status = 'offline', ended_at = NOW()
             WHERE id = $1`,
            [stream.id]
        );

        // Clean up Redis
        await redis.setStreamOffline(stream.stream_key);

        logger.info(`Stream force stopped: ${stream.stream_key} by ${req.user.username}`);

        res.json({
            message: 'Stream stopped successfully'
        });

    } catch (error) {
        logger.error('Error stopping stream:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to stop stream'
        });
    }
});

/**
 * GET /api/streams/:id/stats
 * Get stream statistics
 */
router.get('/:id/stats', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { period = '1h' } = req.query;

        // Get stream
        const streamResult = await db.query(
            `SELECT id, stream_key FROM streams
             WHERE (id::text = $1 OR stream_key = $1) AND is_active = true`,
            [id]
        );

        if (streamResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Stream not found'
            });
        }

        const stream = streamResult.rows[0];

        // Calculate time range
        let interval;
        switch (period) {
            case '1h': interval = '1 hour'; break;
            case '24h': interval = '24 hours'; break;
            case '7d': interval = '7 days'; break;
            case '30d': interval = '30 days'; break;
            default: interval = '1 hour';
        }

        // Get historical stats
        const statsResult = await db.query(
            `SELECT * FROM stream_stats
             WHERE stream_id = $1 AND timestamp > NOW() - INTERVAL '${interval}'
             ORDER BY timestamp ASC`,
            [stream.id]
        );

        // Get current viewer count
        const currentViewers = await redis.getViewerCount(stream.stream_key);

        // Get peak viewers
        const peakResult = await db.query(
            `SELECT MAX(viewers) as peak_viewers
             FROM stream_stats
             WHERE stream_id = $1 AND timestamp > NOW() - INTERVAL '${interval}'`,
            [stream.id]
        );

        res.json({
            current_viewers: currentViewers,
            peak_viewers: peakResult.rows[0]?.peak_viewers || currentViewers,
            history: statsResult.rows
        });

    } catch (error) {
        logger.error('Error getting stream stats:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get stream stats'
        });
    }
});

/**
 * POST /api/streams/:id/regenerate-key
 * Regenerate stream key
 */
router.post('/:id/regenerate-key', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Generate new stream key
        const newStreamKey = tokenService.generateStreamKey();

        const result = await db.query(
            `UPDATE streams SET stream_key = $1
             WHERE (id::text = $2 OR stream_key = $2) AND is_active = true
             RETURNING *`,
            [newStreamKey, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Stream not found'
            });
        }

        logger.info(`Stream key regenerated: ${id} -> ${newStreamKey} by ${req.user.username}`);

        res.json({
            message: 'Stream key regenerated successfully',
            stream: result.rows[0],
            rtmpUrl: `rtmp://your-server/live/${newStreamKey}`
        });

    } catch (error) {
        logger.error('Error regenerating stream key:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to regenerate stream key'
        });
    }
});

/**
 * GET /api/streams/live
 * Get all currently live streams
 */
router.get('/status/live', async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, name, stream_key, started_at
             FROM streams
             WHERE status = 'live' AND is_active = true
             ORDER BY started_at DESC`
        );

        // Add viewer counts
        const streams = await Promise.all(result.rows.map(async (stream) => {
            const viewerCount = await redis.getViewerCount(stream.stream_key);
            return {
                ...stream,
                current_viewers: viewerCount
            };
        }));

        res.json({ streams });

    } catch (error) {
        logger.error('Error getting live streams:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get live streams'
        });
    }
});

module.exports = router;
