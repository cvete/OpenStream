/**
 * Token Service for Stream Playback Security
 * Handles generation and validation of secure playback tokens
 */

const crypto = require('crypto');
const config = require('../config');
const logger = require('./logger');
const db = require('./database');
const redis = require('./redis');

/**
 * Generate a secure playback token
 * @param {string} streamKey - The stream key
 * @param {string} viewerIp - Viewer's IP address (optional, for IP binding)
 * @param {number} expiresInHours - Token expiration time in hours
 * @returns {object} Token data
 */
function generatePlaybackToken(streamKey, viewerIp = null, expiresInHours = null) {
    const expiry = expiresInHours || config.token.expiryHours;
    const expires = Math.floor(Date.now() / 1000) + (expiry * 3600);

    // Create data string for HMAC
    const data = viewerIp
        ? `${streamKey}-${expires}-${viewerIp}`
        : `${streamKey}-${expires}`;

    // Generate HMAC-SHA256 signature
    const signature = crypto
        .createHmac('sha256', config.token.secret)
        .update(data)
        .digest('hex');

    return {
        token: signature,
        expires: expires,
        streamKey: streamKey,
        viewerIp: viewerIp
    };
}

/**
 * Validate a playback token
 * @param {string} streamKey - The stream key
 * @param {string} token - The token to validate
 * @param {number} expires - Token expiration timestamp
 * @param {string} viewerIp - Viewer's IP address
 * @returns {object} Validation result
 */
function validatePlaybackToken(streamKey, token, expires, viewerIp = null) {
    // Check if token has expired
    const now = Math.floor(Date.now() / 1000);
    if (expires < now) {
        return {
            valid: false,
            reason: 'Token has expired'
        };
    }

    // Recreate the expected token
    const data = viewerIp
        ? `${streamKey}-${expires}-${viewerIp}`
        : `${streamKey}-${expires}`;

    const expectedToken = crypto
        .createHmac('sha256', config.token.secret)
        .update(data)
        .digest('hex');

    // Compare tokens (timing-safe comparison)
    const tokenBuffer = Buffer.from(token, 'hex');
    const expectedBuffer = Buffer.from(expectedToken, 'hex');

    if (tokenBuffer.length !== expectedBuffer.length) {
        return {
            valid: false,
            reason: 'Invalid token format'
        };
    }

    const isValid = crypto.timingSafeEqual(tokenBuffer, expectedBuffer);

    return {
        valid: isValid,
        reason: isValid ? null : 'Invalid token'
    };
}

/**
 * Store token in database for tracking
 */
async function storeToken(streamKey, token, viewerIp, expiresAt) {
    try {
        // Get stream ID
        const streamResult = await db.query(
            'SELECT id FROM streams WHERE stream_key = $1',
            [streamKey]
        );

        if (streamResult.rows.length === 0) {
            return null;
        }

        const streamId = streamResult.rows[0].id;

        // Store token
        const result = await db.query(
            `INSERT INTO playback_tokens (stream_id, token, viewer_ip, expires_at)
             VALUES ($1, $2, $3, to_timestamp($4))
             RETURNING id`,
            [streamId, token, viewerIp, expiresAt]
        );

        return result.rows[0].id;
    } catch (error) {
        logger.error('Error storing token:', error);
        return null;
    }
}

/**
 * Cache token validation result in Redis
 */
async function cacheTokenValidation(token, streamKey, isValid, ttlSeconds = 60) {
    const cacheKey = `token:${token}:${streamKey}`;
    await redis.set(cacheKey, { valid: isValid }, ttlSeconds);
}

/**
 * Check cached token validation
 */
async function getCachedTokenValidation(token, streamKey) {
    const cacheKey = `token:${token}:${streamKey}`;
    return await redis.get(cacheKey);
}

/**
 * Parse token from URL query string
 * Expected format: ?token=xxx&expires=timestamp
 */
function parseTokenFromUri(uri) {
    try {
        const url = new URL(uri, 'http://localhost');
        const token = url.searchParams.get('token');
        const expires = url.searchParams.get('expires');

        if (!token || !expires) {
            return null;
        }

        // Extract stream key from path
        // Path format: /live/{stream-key}/index.m3u8
        const pathMatch = url.pathname.match(/^\/(?:live|vod)\/([^\/]+)/);
        const streamKey = pathMatch ? pathMatch[1] : null;

        return {
            token,
            expires: parseInt(expires),
            streamKey
        };
    } catch (error) {
        logger.error('Error parsing token from URI:', error);
        return null;
    }
}

/**
 * Generate a complete playback URL with token
 */
function generatePlaybackUrl(baseUrl, streamKey, viewerIp = null, expiresInHours = null) {
    const tokenData = generatePlaybackToken(streamKey, viewerIp, expiresInHours);

    // Construct URL
    const url = new URL(`${baseUrl}/live/${streamKey}/index.m3u8`);
    url.searchParams.set('token', tokenData.token);
    url.searchParams.set('expires', tokenData.expires.toString());

    return {
        url: url.toString(),
        token: tokenData.token,
        expires: tokenData.expires,
        expiresAt: new Date(tokenData.expires * 1000).toISOString()
    };
}

/**
 * Clean up expired tokens from database
 */
async function cleanupExpiredTokens() {
    try {
        const result = await db.query(
            'DELETE FROM playback_tokens WHERE expires_at < NOW()'
        );
        logger.info(`Cleaned up ${result.rowCount} expired tokens`);
        return result.rowCount;
    } catch (error) {
        logger.error('Error cleaning up expired tokens:', error);
        return 0;
    }
}

/**
 * Generate a random stream key
 */
function generateStreamKey(length = 20) {
    return crypto.randomBytes(length).toString('hex').substring(0, length);
}

module.exports = {
    generatePlaybackToken,
    validatePlaybackToken,
    storeToken,
    cacheTokenValidation,
    getCachedTokenValidation,
    parseTokenFromUri,
    generatePlaybackUrl,
    cleanupExpiredTokens,
    generateStreamKey
};
