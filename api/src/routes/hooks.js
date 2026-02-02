/**
 * SRS HTTP Callback Hooks
 * These endpoints are called by SRS for stream events
 */

const express = require('express');
const router = express.Router();

const db = require('../services/database');
const redis = require('../services/redis');
const logger = require('../services/logger');
const { verifyWebhookSignature } = require('../middleware/webhookAuth');

/**
 * POST /api/hooks/publish
 * Called when a stream starts publishing
 */
router.post('/publish', verifyWebhookSignature, async (req, res) => {
    try {
        const {
            action,
            client_id,
            ip,
            vhost,
            app,
            stream,
            param,
            tcUrl
        } = req.body;

        logger.info(`Publish hook: ${stream} from ${ip}`);

        // Validate stream key exists and is active
        const result = await db.query(
            `SELECT * FROM streams WHERE stream_key = $1 AND is_active = true`,
            [stream]
        );

        if (result.rows.length === 0) {
            logger.warn(`Publish rejected: Unknown stream key ${stream}`);
            // Return error to reject the stream
            return res.status(403).json({ code: 1, message: 'Invalid stream key' });
        }

        const streamData = result.rows[0];

        // Check if stream is already live (prevent duplicate publishing)
        if (streamData.status === 'live') {
            logger.warn(`Publish rejected: Stream ${stream} is already live`);
            return res.status(403).json({ code: 1, message: 'Stream is already live' });
        }

        // Update stream status to live
        await db.query(
            `UPDATE streams SET
                status = 'live',
                started_at = NOW(),
                ended_at = NULL,
                current_viewers = 0
             WHERE id = $1`,
            [streamData.id]
        );

        // Store in Redis for quick access
        await redis.setStreamLive(stream, {
            id: streamData.id,
            name: streamData.name,
            startedAt: new Date().toISOString(),
            clientId: client_id,
            ip: ip
        });

        logger.info(`Stream ${stream} (${streamData.name}) is now live`);

        // Return success (code 0 allows the stream)
        res.json({ code: 0 });

    } catch (error) {
        logger.error('Publish hook error:', error);
        // On error, reject the stream to be safe
        res.status(500).json({ code: 1, message: 'Internal error' });
    }
});

/**
 * POST /api/hooks/unpublish
 * Called when a stream stops publishing
 */
router.post('/unpublish', verifyWebhookSignature, async (req, res) => {
    try {
        const {
            action,
            client_id,
            ip,
            vhost,
            app,
            stream
        } = req.body;

        logger.info(`Unpublish hook: ${stream} from ${ip}`);

        // Update stream status
        const result = await db.query(
            `UPDATE streams SET
                status = 'ended',
                ended_at = NOW()
             WHERE stream_key = $1 AND status = 'live'
             RETURNING *`,
            [stream]
        );

        if (result.rows.length > 0) {
            const streamData = result.rows[0];

            // Get final viewer count before cleanup
            const finalViewers = await redis.getViewerCount(stream);

            // Update max viewers if current exceeds
            if (finalViewers > streamData.max_viewers) {
                await db.query(
                    `UPDATE streams SET max_viewers = $1 WHERE id = $2`,
                    [finalViewers, streamData.id]
                );
            }

            // Clean up Redis
            await redis.setStreamOffline(stream);

            logger.info(`Stream ${stream} (${streamData.name}) has ended`);
        }

        // Always return success
        res.json({ code: 0 });

    } catch (error) {
        logger.error('Unpublish hook error:', error);
        res.json({ code: 0 }); // Still return success
    }
});

/**
 * POST /api/hooks/play
 * Called when a viewer starts watching
 */
router.post('/play', verifyWebhookSignature, async (req, res) => {
    try {
        const {
            action,
            client_id,
            ip,
            vhost,
            app,
            stream,
            pageUrl
        } = req.body;

        logger.debug(`Play hook: ${stream} client ${client_id} from ${ip}`);

        // Check if stream exists and is live
        const result = await db.query(
            `SELECT id FROM streams WHERE stream_key = $1 AND status = 'live' AND is_active = true`,
            [stream]
        );

        if (result.rows.length === 0) {
            logger.warn(`Play rejected: Stream ${stream} not found or not live`);
            return res.status(403).json({ code: 1, message: 'Stream not available' });
        }

        // Add viewer to Redis
        const viewerId = `${client_id}-${ip}`;
        await redis.addViewer(stream, viewerId);

        // Update viewer count in database periodically (not every request)
        const viewerCount = await redis.getViewerCount(stream);

        // Update total views
        await db.query(
            `UPDATE streams SET total_views = total_views + 1, current_viewers = $1 WHERE stream_key = $2`,
            [viewerCount, stream]
        );

        // Log access
        // await domainService.logAccessAttempt(stream, 'play', ip, null, pageUrl, true);

        res.json({ code: 0 });

    } catch (error) {
        logger.error('Play hook error:', error);
        res.json({ code: 0 }); // Allow playback on error
    }
});

/**
 * POST /api/hooks/stop
 * Called when a viewer stops watching
 */
router.post('/stop', verifyWebhookSignature, async (req, res) => {
    try {
        const {
            action,
            client_id,
            ip,
            vhost,
            app,
            stream
        } = req.body;

        logger.debug(`Stop hook: ${stream} client ${client_id} from ${ip}`);

        // Remove viewer from Redis
        const viewerId = `${client_id}-${ip}`;
        await redis.removeViewer(stream, viewerId);

        // Update viewer count
        const viewerCount = await redis.getViewerCount(stream);
        await db.query(
            `UPDATE streams SET current_viewers = $1 WHERE stream_key = $2`,
            [Math.max(0, viewerCount), stream]
        );

        res.json({ code: 0 });

    } catch (error) {
        logger.error('Stop hook error:', error);
        res.json({ code: 0 });
    }
});

/**
 * POST /api/hooks/dvr
 * Called when a DVR recording is complete
 */
router.post('/dvr', verifyWebhookSignature, async (req, res) => {
    try {
        const {
            action,
            client_id,
            ip,
            vhost,
            app,
            stream,
            cwd,
            file
        } = req.body;

        logger.info(`DVR hook: ${stream} recorded to ${file}`);

        // Get stream info
        const streamResult = await db.query(
            `SELECT id, name FROM streams WHERE stream_key = $1`,
            [stream]
        );

        const streamId = streamResult.rows.length > 0 ? streamResult.rows[0].id : null;
        const streamName = streamResult.rows.length > 0 ? streamResult.rows[0].name : stream;

        // Create recording entry
        await db.query(
            `INSERT INTO recordings (stream_id, stream_name, file_path, status)
             VALUES ($1, $2, $3, 'completed')`,
            [streamId, streamName, file]
        );

        logger.info(`Recording saved: ${file}`);

        res.json({ code: 0 });

    } catch (error) {
        logger.error('DVR hook error:', error);
        res.json({ code: 0 });
    }
});

/**
 * POST /api/hooks/hls
 * Called for HLS events (optional)
 */
router.post('/hls', verifyWebhookSignature, async (req, res) => {
    try {
        const { action, client_id, ip, vhost, app, stream, duration, cwd, file, url } = req.body;

        logger.debug(`HLS hook: ${action} for ${stream}`);

        // Can be used to track HLS segment creation
        // Useful for monitoring and debugging

        res.json({ code: 0 });

    } catch (error) {
        logger.error('HLS hook error:', error);
        res.json({ code: 0 });
    }
});

/**
 * POST /api/hooks/on_connect
 * Called when RTMP client connects (before publish/play)
 */
router.post('/on_connect', verifyWebhookSignature, async (req, res) => {
    try {
        const { action, client_id, ip, vhost, app, tcUrl, pageUrl } = req.body;

        logger.debug(`Connect hook: client ${client_id} from ${ip} to ${app}`);

        // Could implement IP blacklisting here
        // For now, allow all connections

        res.json({ code: 0 });

    } catch (error) {
        logger.error('Connect hook error:', error);
        res.json({ code: 0 });
    }
});

/**
 * POST /api/hooks/on_close
 * Called when RTMP client disconnects
 */
router.post('/on_close', verifyWebhookSignature, async (req, res) => {
    try {
        const { action, client_id, ip, vhost, app, send_bytes, recv_bytes } = req.body;

        logger.debug(`Close hook: client ${client_id} from ${ip}, sent: ${send_bytes}, recv: ${recv_bytes}`);

        res.json({ code: 0 });

    } catch (error) {
        logger.error('Close hook error:', error);
        res.json({ code: 0 });
    }
});

module.exports = router;
