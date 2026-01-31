/**
 * Statistics Routes
 */

const express = require('express');
const router = express.Router();
const axios = require('axios');

const db = require('../services/database');
const redis = require('../services/redis');
const logger = require('../services/logger');
const config = require('../config');
const { verifyToken, requireAdmin } = require('../middleware/auth');

/**
 * GET /api/stats/server
 * Get server statistics
 */
router.get('/server', verifyToken, async (req, res) => {
    try {
        // Get live streams count
        const liveResult = await db.query(
            `SELECT COUNT(*) as count FROM streams WHERE status = 'live' AND is_active = true`
        );

        // Get total streams
        const totalStreamsResult = await db.query(
            `SELECT COUNT(*) as count FROM streams WHERE is_active = true`
        );

        // Get total recordings
        const recordingsResult = await db.query(
            `SELECT COUNT(*) as count FROM recordings WHERE status != 'deleted'`
        );

        // Get total views today
        const viewsTodayResult = await db.query(
            `SELECT COALESCE(SUM(total_views), 0) as views
             FROM streams
             WHERE DATE(updated_at) = CURRENT_DATE`
        );

        // Get current total viewers from Redis
        const liveStreams = await redis.getLiveStreams();
        let totalViewers = 0;
        for (const streamKey of Object.keys(liveStreams)) {
            totalViewers += await redis.getViewerCount(streamKey);
        }

        // Get SRS server stats (if available)
        let srsStats = null;
        try {
            const srsResponse = await axios.get(`${config.srs.apiUrl}/api/v1/summaries`, {
                timeout: 5000
            });
            srsStats = srsResponse.data;
        } catch (srsError) {
            logger.debug('Could not fetch SRS stats:', srsError.message);
        }

        res.json({
            live_streams: parseInt(liveResult.rows[0].count),
            total_streams: parseInt(totalStreamsResult.rows[0].count),
            total_recordings: parseInt(recordingsResult.rows[0].count),
            current_viewers: totalViewers,
            views_today: parseInt(viewsTodayResult.rows[0].views),
            srs: srsStats,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Error getting server stats:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get server statistics'
        });
    }
});

/**
 * GET /api/stats/bandwidth
 * Get bandwidth statistics
 */
router.get('/bandwidth', verifyToken, async (req, res) => {
    try {
        const { period = '24h' } = req.query;

        // Calculate time range
        let interval;
        switch (period) {
            case '1h': interval = '1 hour'; break;
            case '24h': interval = '24 hours'; break;
            case '7d': interval = '7 days'; break;
            case '30d': interval = '30 days'; break;
            default: interval = '24 hours';
        }

        // Get bandwidth from stream stats
        const result = await db.query(
            `SELECT
                date_trunc('hour', timestamp) as hour,
                SUM(bandwidth_in) as bandwidth_in,
                SUM(bandwidth_out) as bandwidth_out,
                AVG(viewers) as avg_viewers
             FROM stream_stats
             WHERE timestamp > NOW() - INTERVAL '${interval}'
             GROUP BY date_trunc('hour', timestamp)
             ORDER BY hour ASC`
        );

        // Get totals
        const totalsResult = await db.query(
            `SELECT
                COALESCE(SUM(bandwidth_in), 0) as total_in,
                COALESCE(SUM(bandwidth_out), 0) as total_out,
                COALESCE(MAX(viewers), 0) as peak_viewers
             FROM stream_stats
             WHERE timestamp > NOW() - INTERVAL '${interval}'`
        );

        res.json({
            period,
            history: result.rows,
            totals: totalsResult.rows[0],
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Error getting bandwidth stats:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get bandwidth statistics'
        });
    }
});

/**
 * GET /api/stats/viewers
 * Get viewer statistics
 */
router.get('/viewers', verifyToken, async (req, res) => {
    try {
        const { period = '24h' } = req.query;

        let interval;
        switch (period) {
            case '1h': interval = '1 hour'; break;
            case '24h': interval = '24 hours'; break;
            case '7d': interval = '7 days'; break;
            case '30d': interval = '30 days'; break;
            default: interval = '24 hours';
        }

        // Get viewer history
        const result = await db.query(
            `SELECT
                date_trunc('hour', timestamp) as hour,
                SUM(viewers) as total_viewers,
                COUNT(DISTINCT stream_id) as active_streams
             FROM stream_stats
             WHERE timestamp > NOW() - INTERVAL '${interval}'
             GROUP BY date_trunc('hour', timestamp)
             ORDER BY hour ASC`
        );

        // Get current viewers by stream
        const liveStreams = await redis.getLiveStreams();
        const currentByStream = [];

        for (const [streamKey, streamData] of Object.entries(liveStreams)) {
            const viewers = await redis.getViewerCount(streamKey);
            currentByStream.push({
                stream_key: streamKey,
                name: streamData.name,
                viewers
            });
        }

        // Sort by viewer count
        currentByStream.sort((a, b) => b.viewers - a.viewers);

        res.json({
            period,
            history: result.rows,
            current_by_stream: currentByStream,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Error getting viewer stats:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get viewer statistics'
        });
    }
});

/**
 * GET /api/stats/access-logs
 * Get access logs (blocked attempts, etc.)
 */
router.get('/access-logs', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 50, filter } = req.query;
        const offset = (page - 1) * limit;

        let query = `SELECT * FROM access_logs`;
        const params = [];

        if (filter === 'blocked') {
            query += ` WHERE is_allowed = false`;
        }

        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await db.query(query, params);

        // Get total count
        let countQuery = `SELECT COUNT(*) FROM access_logs`;
        if (filter === 'blocked') {
            countQuery += ` WHERE is_allowed = false`;
        }
        const countResult = await db.query(countQuery);

        res.json({
            logs: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: parseInt(countResult.rows[0].count)
            }
        });

    } catch (error) {
        logger.error('Error getting access logs:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get access logs'
        });
    }
});

/**
 * GET /api/stats/top-streams
 * Get top streams by viewers
 */
router.get('/top-streams', verifyToken, async (req, res) => {
    try {
        const { period = '24h', limit = 10 } = req.query;

        let interval;
        switch (period) {
            case '24h': interval = '24 hours'; break;
            case '7d': interval = '7 days'; break;
            case '30d': interval = '30 days'; break;
            default: interval = '24 hours';
        }

        const result = await db.query(
            `SELECT
                s.id,
                s.name,
                s.stream_key,
                s.total_views,
                s.max_viewers,
                COALESCE(AVG(ss.viewers), 0) as avg_viewers
             FROM streams s
             LEFT JOIN stream_stats ss ON s.id = ss.stream_id
                AND ss.timestamp > NOW() - INTERVAL '${interval}'
             WHERE s.is_active = true
             GROUP BY s.id
             ORDER BY s.total_views DESC
             LIMIT $1`,
            [parseInt(limit)]
        );

        res.json({
            period,
            streams: result.rows
        });

    } catch (error) {
        logger.error('Error getting top streams:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get top streams'
        });
    }
});

/**
 * POST /api/stats/record
 * Record stream statistics (called periodically)
 */
router.post('/record', async (req, res) => {
    try {
        // This endpoint can be called by a cron job to record stats
        const liveStreams = await redis.getLiveStreams();

        for (const [streamKey, streamData] of Object.entries(liveStreams)) {
            const viewers = await redis.getViewerCount(streamKey);

            // Get stream ID
            const streamResult = await db.query(
                `SELECT id FROM streams WHERE stream_key = $1`,
                [streamKey]
            );

            if (streamResult.rows.length > 0) {
                await db.query(
                    `INSERT INTO stream_stats (stream_id, viewers)
                     VALUES ($1, $2)`,
                    [streamResult.rows[0].id, viewers]
                );
            }
        }

        res.json({ message: 'Stats recorded', streams_recorded: Object.keys(liveStreams).length });

    } catch (error) {
        logger.error('Error recording stats:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to record statistics'
        });
    }
});

module.exports = router;
