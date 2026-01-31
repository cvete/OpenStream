/**
 * VOD (Video on Demand) Routes
 */

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;

const db = require('../services/database');
const logger = require('../services/logger');
const config = require('../config');
const { verifyToken, requireAdmin } = require('../middleware/auth');

/**
 * GET /api/vod
 * List all VOD recordings
 */
router.get('/', verifyToken, async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        let query = `
            SELECT r.*, s.name as stream_name, s.stream_key
            FROM recordings r
            LEFT JOIN streams s ON r.stream_id = s.id
            WHERE r.status != 'deleted'
        `;
        const params = [];

        if (status) {
            params.push(status);
            query += ` AND r.status = $${params.length}`;
        }

        query += ` ORDER BY r.recorded_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await db.query(query, params);

        // Get total count
        const countResult = await db.query(
            `SELECT COUNT(*) FROM recordings WHERE status != 'deleted' ${status ? 'AND status = $1' : ''}`,
            status ? [status] : []
        );

        res.json({
            recordings: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: parseInt(countResult.rows[0].count),
                totalPages: Math.ceil(countResult.rows[0].count / limit)
            }
        });

    } catch (error) {
        logger.error('Error listing VOD:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to list recordings'
        });
    }
});

/**
 * GET /api/vod/:id
 * Get VOD recording details
 */
router.get('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            `SELECT r.*, s.name as stream_name, s.stream_key
             FROM recordings r
             LEFT JOIN streams s ON r.stream_id = s.id
             WHERE r.id = $1 AND r.status != 'deleted'`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Recording not found'
            });
        }

        const recording = result.rows[0];

        // Generate playback URL
        if (recording.hls_path) {
            recording.playback_url = `/vod/${recording.id}/index.m3u8`;
        }

        res.json(recording);

    } catch (error) {
        logger.error('Error getting VOD:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get recording'
        });
    }
});

/**
 * POST /api/vod/:id/transcode
 * Start transcoding a recording to HLS
 */
router.post('/:id/transcode', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        // Get recording
        const result = await db.query(
            `SELECT * FROM recordings WHERE id = $1 AND status = 'completed'`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Recording not found or not ready for transcoding'
            });
        }

        const recording = result.rows[0];

        // Update status to processing
        await db.query(
            `UPDATE recordings SET status = 'processing' WHERE id = $1`,
            [id]
        );

        // TODO: Implement FFmpeg transcoding job
        // This would typically be handled by a job queue (Bull, Agenda, etc.)
        // For now, we'll just mark it as processing

        logger.info(`Transcoding started for recording ${id}`);

        res.json({
            message: 'Transcoding started',
            recording_id: id,
            status: 'processing'
        });

    } catch (error) {
        logger.error('Error starting transcoding:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to start transcoding'
        });
    }
});

/**
 * DELETE /api/vod/:id
 * Delete a VOD recording
 */
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { deleteFile = false } = req.query;

        // Get recording
        const result = await db.query(
            `SELECT * FROM recordings WHERE id = $1 AND status != 'deleted'`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Recording not found'
            });
        }

        const recording = result.rows[0];

        // Soft delete
        await db.query(
            `UPDATE recordings SET status = 'deleted' WHERE id = $1`,
            [id]
        );

        // Optionally delete file from disk
        if (deleteFile && recording.file_path) {
            try {
                await fs.unlink(recording.file_path);
                logger.info(`Deleted file: ${recording.file_path}`);
            } catch (fileError) {
                logger.warn(`Failed to delete file: ${recording.file_path}`, fileError);
            }
        }

        logger.info(`Recording deleted: ${id} by ${req.user.username}`);

        res.json({
            message: 'Recording deleted successfully'
        });

    } catch (error) {
        logger.error('Error deleting VOD:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to delete recording'
        });
    }
});

/**
 * PUT /api/vod/:id
 * Update recording metadata
 */
router.put('/:id', verifyToken, [
    body('stream_name').optional().trim().notEmpty()
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
        const { stream_name } = req.body;

        const result = await db.query(
            `UPDATE recordings SET stream_name = COALESCE($1, stream_name)
             WHERE id = $2 AND status != 'deleted'
             RETURNING *`,
            [stream_name, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Recording not found'
            });
        }

        res.json({
            message: 'Recording updated',
            recording: result.rows[0]
        });

    } catch (error) {
        logger.error('Error updating VOD:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to update recording'
        });
    }
});

/**
 * GET /api/vod/stream/:streamKey
 * Get all recordings for a specific stream
 */
router.get('/stream/:streamKey', verifyToken, async (req, res) => {
    try {
        const { streamKey } = req.params;

        const result = await db.query(
            `SELECT r.* FROM recordings r
             JOIN streams s ON r.stream_id = s.id
             WHERE s.stream_key = $1 AND r.status != 'deleted'
             ORDER BY r.recorded_at DESC`,
            [streamKey]
        );

        res.json({ recordings: result.rows });

    } catch (error) {
        logger.error('Error getting stream recordings:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get recordings'
        });
    }
});

/**
 * GET /api/vod/:id/download
 * Get download URL for a recording
 */
router.get('/:id/download', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await db.query(
            `SELECT file_path, stream_name FROM recordings
             WHERE id = $1 AND status IN ('completed', 'ready')`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Recording not found or not ready'
            });
        }

        const recording = result.rows[0];

        // Check if file exists
        try {
            await fs.access(recording.file_path);
        } catch {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Recording file not found on disk'
            });
        }

        // Increment view count
        await db.query(
            `UPDATE recordings SET views = views + 1 WHERE id = $1`,
            [id]
        );

        // Generate download URL or send file
        const filename = `${recording.stream_name || 'recording'}-${id}.flv`;
        res.download(recording.file_path, filename);

    } catch (error) {
        logger.error('Error downloading VOD:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to download recording'
        });
    }
});

module.exports = router;
