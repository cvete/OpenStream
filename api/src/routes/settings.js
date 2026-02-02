/**
 * Settings Management Routes
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const db = require('../services/database');
const redis = require('../services/redis');
const logger = require('../services/logger');
const { verifyToken, requireAdmin } = require('../middleware/auth');

/**
 * GET /api/settings
 * Get all settings
 */
router.get('/', verifyToken, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT key, value, description FROM settings ORDER BY key'
        );

        const settings = {};
        result.rows.forEach(row => {
            // Try to parse JSON values
            try {
                settings[row.key] = JSON.parse(row.value);
            } catch {
                settings[row.key] = row.value;
            }
        });

        res.json({
            settings,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Error getting settings:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get settings'
        });
    }
});

/**
 * GET /api/settings/:key
 * Get specific setting
 */
router.get('/:key', verifyToken, async (req, res) => {
    try {
        const { key } = req.params;

        const result = await db.query(
            'SELECT key, value, description FROM settings WHERE key = $1',
            [key]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Setting not found'
            });
        }

        const setting = result.rows[0];

        // Try to parse JSON value
        try {
            setting.value = JSON.parse(setting.value);
        } catch {
            // Keep as string if not JSON
        }

        res.json(setting);

    } catch (error) {
        logger.error('Error getting setting:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get setting'
        });
    }
});

/**
 * PUT /api/settings/:key
 * Update setting
 */
router.put('/:key', verifyToken, requireAdmin, [
    body('value').notEmpty().withMessage('Value is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const { key } = req.params;
        let { value } = req.body;

        // Convert objects to JSON string for storage
        if (typeof value === 'object') {
            value = JSON.stringify(value);
        }

        const result = await db.query(
            `INSERT INTO settings (key, value, updated_at)
             VALUES ($1, $2, NOW())
             ON CONFLICT (key)
             DO UPDATE SET value = $2, updated_at = NOW()
             RETURNING *`,
            [key, value]
        );

        logger.info(`Setting updated: ${key} by ${req.user.username}`);

        // Try to parse JSON value for response
        let responseValue = result.rows[0].value;
        try {
            responseValue = JSON.parse(responseValue);
        } catch {
            // Keep as string if not JSON
        }

        res.json({
            message: 'Setting updated successfully',
            setting: {
                key: result.rows[0].key,
                value: responseValue
            }
        });

    } catch (error) {
        logger.error('Error updating setting:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to update setting'
        });
    }
});

/**
 * GET /api/config/server
 * Get server configuration and status
 */
router.get('/config/server', verifyToken, async (req, res) => {
    try {
        // Check Redis connection
        let redisStatus = 'disconnected';
        try {
            await redis.client.ping();
            redisStatus = 'connected';
        } catch (redisError) {
            logger.debug('Redis ping failed:', redisError.message);
        }

        // Check database connection
        let dbStatus = 'disconnected';
        try {
            await db.query('SELECT 1');
            dbStatus = 'connected';
        } catch (dbError) {
            logger.debug('Database ping failed:', dbError.message);
        }

        // Get system info
        const uptime = process.uptime();
        const memoryUsage = process.memoryUsage();

        res.json({
            status: 'online',
            redis_status: redisStatus,
            db_status: dbStatus,
            version: process.env.npm_package_version || '1.0.0',
            node_version: process.version,
            uptime_seconds: Math.floor(uptime),
            memory_usage: {
                rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB',
                heap_used: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
                heap_total: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        logger.error('Error getting server config:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get server configuration'
        });
    }
});

module.exports = router;
