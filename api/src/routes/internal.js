/**
 * Internal Routes for NGINX auth_request
 * These endpoints are called by NGINX for validation
 */

const express = require('express');
const router = express.Router();

const logger = require('../services/logger');
const tokenService = require('../services/tokenService');
const domainService = require('../services/domainService');
const db = require('../services/database');
const { verifyToken } = require('../middleware/auth');

/**
 * GET /api/internal/validate-token
 * Called by NGINX auth_request for stream access validation
 * Returns 200 for valid access, 403 for denied
 */
router.get('/validate-token', async (req, res) => {
    try {
        // Get original URI from NGINX
        const originalUri = req.headers['x-original-uri'] || req.query.uri;
        const viewerIp = req.headers['x-real-ip'] || req.ip;
        const referer = req.headers['referer'];
        const userAgent = req.headers['user-agent'];

        if (!originalUri) {
            logger.warn('Token validation: No original URI provided');
            return res.status(403).send('Forbidden');
        }

        // Parse token from URI
        const tokenData = tokenService.parseTokenFromUri(originalUri);

        if (!tokenData) {
            logger.warn(`Token validation failed: No token in URI ${originalUri}`);
            await domainService.logAccessAttempt(
                null, 'token_validation', viewerIp, userAgent, referer, false, 'No token'
            );
            return res.status(403).send('Forbidden');
        }

        const { token, expires, streamKey } = tokenData;

        // Check cache first
        const cached = await tokenService.getCachedTokenValidation(token, streamKey);
        if (cached !== null) {
            if (cached.valid) {
                return res.status(200).send('OK');
            } else {
                return res.status(403).send('Forbidden');
            }
        }

        // Validate token
        const validation = tokenService.validatePlaybackToken(streamKey, token, expires, null);

        if (!validation.valid) {
            logger.warn(`Token validation failed for ${streamKey}: ${validation.reason}`);
            await tokenService.cacheTokenValidation(token, streamKey, false);
            await domainService.logAccessAttempt(
                streamKey, 'token_validation', viewerIp, userAgent, referer, false, validation.reason
            );
            return res.status(403).send('Forbidden');
        }

        // Check domain allowance
        const refererDomain = domainService.extractDomainFromReferer(referer);
        const isDomainAllowed = await domainService.isDomainAllowed(streamKey, refererDomain);

        if (!isDomainAllowed) {
            logger.warn(`Domain not allowed for ${streamKey}: ${refererDomain}`);
            await tokenService.cacheTokenValidation(token, streamKey, false);
            await domainService.logAccessAttempt(
                streamKey, 'domain_check', viewerIp, userAgent, referer, false, 'Domain not allowed'
            );
            return res.status(403).send('Forbidden');
        }

        // Check if stream exists and is available
        const streamResult = await db.query(
            `SELECT id, status FROM streams WHERE stream_key = $1 AND is_active = true`,
            [streamKey]
        );

        if (streamResult.rows.length === 0) {
            logger.warn(`Stream not found: ${streamKey}`);
            await tokenService.cacheTokenValidation(token, streamKey, false);
            return res.status(404).send('Not Found');
        }

        // Cache successful validation
        await tokenService.cacheTokenValidation(token, streamKey, true);

        // Log successful access
        await domainService.logAccessAttempt(
            streamKey, 'access', viewerIp, userAgent, referer, true
        );

        return res.status(200).send('OK');

    } catch (error) {
        logger.error('Token validation error:', error);
        // On error, deny access for security
        return res.status(403).send('Forbidden');
    }
});

/**
 * GET /api/internal/validate-admin
 * Called by NGINX auth_request for admin-only endpoints
 */
router.get('/validate-admin', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).send('Unauthorized');
        }

        // Use the verifyToken middleware logic
        const token = authHeader.split(' ')[1];
        const jwt = require('jsonwebtoken');
        const config = require('../config');

        try {
            const decoded = jwt.verify(token, config.jwt.secret);

            if (decoded.role !== 'admin') {
                return res.status(403).send('Forbidden');
            }

            return res.status(200).send('OK');
        } catch (jwtError) {
            return res.status(401).send('Unauthorized');
        }

    } catch (error) {
        logger.error('Admin validation error:', error);
        return res.status(403).send('Forbidden');
    }
});

/**
 * POST /api/internal/validate-stream-key
 * Validate stream key for publishing (called by SRS)
 */
router.post('/validate-stream-key', async (req, res) => {
    try {
        const { stream_key, ip } = req.body;

        if (!stream_key) {
            return res.status(400).json({ valid: false, message: 'Stream key required' });
        }

        const result = await db.query(
            `SELECT id, name, is_active FROM streams WHERE stream_key = $1`,
            [stream_key]
        );

        if (result.rows.length === 0) {
            logger.warn(`Invalid stream key attempt: ${stream_key} from ${ip}`);
            return res.json({ valid: false, message: 'Invalid stream key' });
        }

        const stream = result.rows[0];

        if (!stream.is_active) {
            return res.json({ valid: false, message: 'Stream is disabled' });
        }

        logger.info(`Stream key validated: ${stream_key} (${stream.name})`);
        return res.json({ valid: true, stream_id: stream.id, name: stream.name });

    } catch (error) {
        logger.error('Stream key validation error:', error);
        return res.status(500).json({ valid: false, message: 'Internal error' });
    }
});

/**
 * GET /api/internal/health
 * Internal health check
 */
router.get('/health', async (req, res) => {
    try {
        // Check database
        await db.query('SELECT 1');

        // Check Redis
        const redis = require('../services/redis');
        await redis.set('health_check', 'ok', 10);

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            services: {
                database: 'ok',
                redis: 'ok'
            }
        });

    } catch (error) {
        logger.error('Health check failed:', error);
        res.status(500).json({
            status: 'unhealthy',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

module.exports = router;
