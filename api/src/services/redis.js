/**
 * Redis Cache Service
 */

const { createClient } = require('redis');
const config = require('../config');
const logger = require('./logger');

let client = null;
let isConnected = false;

/**
 * Initialize Redis connection
 */
async function initRedis() {
    client = createClient({
        url: config.redis.url
    });

    client.on('error', (err) => {
        isConnected = false;
        logger.error('Redis error:', err);
    });

    client.on('connect', () => {
        logger.info('Redis connecting...');
    });

    client.on('ready', () => {
        isConnected = true;
        logger.info('Redis connection ready');
    });

    client.on('end', () => {
        isConnected = false;
    });

    try {
        await client.connect();
    } catch (err) {
        logger.warn('Redis connection failed, running in degraded mode:', err.message);
        isConnected = false;
    }

    return client;
}

/**
 * Safe execution wrapper — returns fallback if Redis is unavailable
 */
async function safeExec(fn, fallback = null) {
    if (!client || !isConnected) return fallback;
    try {
        return await fn();
    } catch (err) {
        logger.warn('Redis operation failed:', err.message);
        return fallback;
    }
}

/**
 * Get Redis client
 */
function getClient() {
    if (!client) {
        throw new Error('Redis not initialized');
    }
    return client;
}

/**
 * Set a value with optional expiration
 */
async function set(key, value, ttlSeconds = null) {
    const serialized = typeof value === 'object' ? JSON.stringify(value) : value;
    if (ttlSeconds) {
        await client.setEx(key, ttlSeconds, serialized);
    } else {
        await client.set(key, serialized);
    }
}

/**
 * Get a value
 */
async function get(key) {
    const value = await client.get(key);
    if (!value) return null;

    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

/**
 * Delete a key
 */
async function del(key) {
    await client.del(key);
}

/**
 * Check if key exists
 */
async function exists(key) {
    return await client.exists(key);
}

/**
 * Increment a value
 */
async function incr(key) {
    return await client.incr(key);
}

/**
 * Decrement a value
 */
async function decr(key) {
    return await client.decr(key);
}

/**
 * Set expiration on a key
 */
async function expire(key, seconds) {
    await client.expire(key, seconds);
}

/**
 * Get all keys matching a pattern
 * WARNING: This uses KEYS which blocks Redis. Use scan() for production.
 * @deprecated Use scan() instead
 */
async function keys(pattern) {
    return await client.keys(pattern);
}

/**
 * Scan for keys matching a pattern (non-blocking alternative to KEYS)
 */
async function scan(pattern, count = 100) {
    const keys = [];
    let cursor = 0;

    do {
        const result = await client.scan(cursor, {
            MATCH: pattern,
            COUNT: count
        });
        cursor = result.cursor;
        keys.push(...result.keys);
    } while (cursor !== 0);

    return keys;
}

/**
 * Hash operations
 */
async function hSet(key, field, value) {
    const serialized = typeof value === 'object' ? JSON.stringify(value) : value;
    await client.hSet(key, field, serialized);
}

async function hGet(key, field) {
    const value = await client.hGet(key, field);
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

async function hGetAll(key) {
    const data = await client.hGetAll(key);
    const result = {};
    for (const [field, value] of Object.entries(data)) {
        try {
            result[field] = JSON.parse(value);
        } catch {
            result[field] = value;
        }
    }
    return result;
}

async function hDel(key, field) {
    await client.hDel(key, field);
}

/**
 * Pub/Sub operations
 */
async function publish(channel, message) {
    const serialized = typeof message === 'object' ? JSON.stringify(message) : message;
    await client.publish(channel, serialized);
}

/**
 * Stream viewer tracking (resilient — degrades gracefully if Redis is down)
 */
async function addViewer(streamKey, viewerId) {
    return safeExec(async () => {
        await client.sAdd(`stream:${streamKey}:viewers`, viewerId);
        await client.incr(`stream:${streamKey}:viewer_count`);
    });
}

async function removeViewer(streamKey, viewerId) {
    return safeExec(async () => {
        await client.sRem(`stream:${streamKey}:viewers`, viewerId);
        await client.decr(`stream:${streamKey}:viewer_count`);
    });
}

async function getViewerCount(streamKey) {
    return safeExec(async () => {
        const count = await client.get(`stream:${streamKey}:viewer_count`);
        return parseInt(count) || 0;
    }, 0);
}

async function getViewerCountsBatch(streamKeys) {
    if (streamKeys.length === 0) return {};
    return safeExec(async () => {
        const pipeline = client.multi();
        streamKeys.forEach(key => {
            pipeline.get(`stream:${key}:viewer_count`);
        });
        const results = await pipeline.exec();
        const counts = {};
        streamKeys.forEach((key, index) => {
            counts[key] = parseInt(results[index]) || 0;
        });
        return counts;
    }, {});
}

async function setStreamLive(streamKey, data) {
    return safeExec(async () => {
        await client.hSet('live_streams', streamKey, JSON.stringify(data));
    });
}

async function setStreamOffline(streamKey) {
    return safeExec(async () => {
        await client.hDel('live_streams', streamKey);
        await client.del(`stream:${streamKey}:viewers`);
        await client.del(`stream:${streamKey}:viewer_count`);
    });
}

async function getLiveStreams() {
    return safeExec(async () => {
        const data = await client.hGetAll('live_streams');
        const streams = {};
        for (const [key, value] of Object.entries(data)) {
            try {
                streams[key] = JSON.parse(value);
            } catch {
                streams[key] = value;
            }
        }
        return streams;
    }, {});
}

/**
 * Disconnect Redis client
 */
async function disconnect() {
    if (client) {
        await client.quit();
        client = null;
        logger.info('Redis connection closed');
    }
}

/**
 * Login attempt tracking for account lockout
 */
async function incrementLoginAttempts(username) {
    return safeExec(async () => {
        const key = `login_attempts:${username}`;
        const count = await client.incr(key);
        if (count === 1) {
            await client.expire(key, Math.ceil(config.security.lockoutDuration / 1000));
        }
        return count;
    }, 0);
}

async function getLoginAttempts(username) {
    return safeExec(async () => {
        const count = await client.get(`login_attempts:${username}`);
        return parseInt(count) || 0;
    }, 0);
}

async function clearLoginAttempts(username) {
    return safeExec(async () => {
        await client.del(`login_attempts:${username}`);
    });
}

/**
 * Token blacklist for revocation
 */
async function blacklistToken(jti, ttlSeconds) {
    return safeExec(async () => {
        await client.setEx(`blacklist:${jti}`, ttlSeconds, '1');
    });
}

async function isTokenBlacklisted(jti) {
    return safeExec(async () => {
        const result = await client.exists(`blacklist:${jti}`);
        return result === 1;
    }, false);
}

module.exports = {
    initRedis,
    disconnect,
    getClient,
    set,
    get,
    del,
    exists,
    incr,
    decr,
    expire,
    keys,
    scan,
    hSet,
    hGet,
    hGetAll,
    hDel,
    publish,
    addViewer,
    removeViewer,
    getViewerCount,
    getViewerCountsBatch,
    setStreamLive,
    setStreamOffline,
    getLiveStreams,
    incrementLoginAttempts,
    getLoginAttempts,
    clearLoginAttempts,
    blacklistToken,
    isTokenBlacklisted
};
