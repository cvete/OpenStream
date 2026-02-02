/**
 * Domain Service for Hotlinking and Domain Protection
 * Manages allowed domains for stream playback
 */

const db = require('./database');
const redis = require('./redis');
const logger = require('./logger');

// Cache TTL in seconds
const CACHE_TTL = 300; // 5 minutes

/**
 * Check if a domain is allowed for a specific stream
 */
async function isDomainAllowed(streamKey, refererDomain) {
    if (!refererDomain) {
        // Allow direct access (no referer)
        return true;
    }

    // Normalize domain
    const domain = normalizeDomain(refererDomain);

    // Check cache first
    const cacheKey = `domain:${streamKey}:${domain}`;
    const cached = await redis.get(cacheKey);
    if (cached !== null) {
        return cached;
    }

    try {
        // Check global allowed domains
        const globalResult = await db.query(
            `SELECT 1 FROM global_domains
             WHERE domain = $1 AND is_active = true`,
            [domain]
        );

        if (globalResult.rows.length > 0) {
            await redis.set(cacheKey, true, CACHE_TTL);
            return true;
        }

        // Check wildcard global domains (e.g., *.example.com)
        const wildcardGlobalResult = await db.query(
            `SELECT 1 FROM global_domains
             WHERE $1 LIKE REPLACE(domain, '*', '%') AND is_active = true`,
            [domain]
        );

        if (wildcardGlobalResult.rows.length > 0) {
            await redis.set(cacheKey, true, CACHE_TTL);
            return true;
        }

        // Get stream ID
        const streamResult = await db.query(
            'SELECT id FROM streams WHERE stream_key = $1',
            [streamKey]
        );

        if (streamResult.rows.length === 0) {
            // Stream not found - deny by default
            await redis.set(cacheKey, false, CACHE_TTL);
            return false;
        }

        const streamId = streamResult.rows[0].id;

        // Check stream-specific allowed domains
        const streamDomainResult = await db.query(
            `SELECT 1 FROM stream_domains
             WHERE stream_id = $1 AND domain = $2 AND is_active = true`,
            [streamId, domain]
        );

        if (streamDomainResult.rows.length > 0) {
            await redis.set(cacheKey, true, CACHE_TTL);
            return true;
        }

        // Check wildcard stream domains
        const wildcardStreamResult = await db.query(
            `SELECT 1 FROM stream_domains
             WHERE stream_id = $1 AND $2 LIKE REPLACE(domain, '*', '%') AND is_active = true`,
            [streamId, domain]
        );

        const isAllowed = wildcardStreamResult.rows.length > 0;
        await redis.set(cacheKey, isAllowed, CACHE_TTL);

        return isAllowed;
    } catch (error) {
        logger.error('Error checking domain allowance:', error);
        // On error, be permissive
        return true;
    }
}

/**
 * Extract domain from referer URL
 */
function extractDomainFromReferer(referer) {
    if (!referer) return null;

    try {
        const url = new URL(referer);
        return url.hostname;
    } catch {
        return null;
    }
}

/**
 * Normalize a domain (remove www., lowercase)
 */
function normalizeDomain(domain) {
    if (!domain) return null;
    return domain.toLowerCase().replace(/^www\./, '');
}

/**
 * Add a global allowed domain
 */
async function addGlobalDomain(domain, description = null) {
    const normalizedDomain = normalizeDomain(domain);

    try {
        const result = await db.query(
            `INSERT INTO global_domains (domain, description)
             VALUES ($1, $2)
             ON CONFLICT (domain) DO UPDATE SET is_active = true, description = $2
             RETURNING *`,
            [normalizedDomain, description]
        );

        // Invalidate cache
        await invalidateDomainCache();

        return result.rows[0];
    } catch (error) {
        logger.error('Error adding global domain:', error);
        throw error;
    }
}

/**
 * Remove a global allowed domain
 */
async function removeGlobalDomain(domain) {
    const normalizedDomain = normalizeDomain(domain);

    try {
        const result = await db.query(
            `UPDATE global_domains SET is_active = false WHERE domain = $1 RETURNING *`,
            [normalizedDomain]
        );

        // Invalidate cache
        await invalidateDomainCache();

        return result.rows[0];
    } catch (error) {
        logger.error('Error removing global domain:', error);
        throw error;
    }
}

/**
 * Get all global allowed domains
 */
async function getGlobalDomains() {
    try {
        const result = await db.query(
            `SELECT * FROM global_domains WHERE is_active = true ORDER BY domain`
        );
        return result.rows;
    } catch (error) {
        logger.error('Error getting global domains:', error);
        throw error;
    }
}

/**
 * Add an allowed domain for a specific stream
 */
async function addStreamDomain(streamKey, domain) {
    const normalizedDomain = normalizeDomain(domain);

    try {
        // Get stream ID
        const streamResult = await db.query(
            'SELECT id FROM streams WHERE stream_key = $1',
            [streamKey]
        );

        if (streamResult.rows.length === 0) {
            throw new Error('Stream not found');
        }

        const streamId = streamResult.rows[0].id;

        const result = await db.query(
            `INSERT INTO stream_domains (stream_id, domain)
             VALUES ($1, $2)
             ON CONFLICT (stream_id, domain) DO UPDATE SET is_active = true
             RETURNING *`,
            [streamId, normalizedDomain]
        );

        // Invalidate cache
        await invalidateDomainCache(streamKey);

        return result.rows[0];
    } catch (error) {
        logger.error('Error adding stream domain:', error);
        throw error;
    }
}

/**
 * Remove an allowed domain from a specific stream
 */
async function removeStreamDomain(streamKey, domain) {
    const normalizedDomain = normalizeDomain(domain);

    try {
        // Get stream ID
        const streamResult = await db.query(
            'SELECT id FROM streams WHERE stream_key = $1',
            [streamKey]
        );

        if (streamResult.rows.length === 0) {
            throw new Error('Stream not found');
        }

        const streamId = streamResult.rows[0].id;

        const result = await db.query(
            `UPDATE stream_domains SET is_active = false
             WHERE stream_id = $1 AND domain = $2
             RETURNING *`,
            [streamId, normalizedDomain]
        );

        // Invalidate cache
        await invalidateDomainCache(streamKey);

        return result.rows[0];
    } catch (error) {
        logger.error('Error removing stream domain:', error);
        throw error;
    }
}

/**
 * Get all allowed domains for a specific stream
 */
async function getStreamDomains(streamKey) {
    try {
        const result = await db.query(
            `SELECT sd.* FROM stream_domains sd
             JOIN streams s ON sd.stream_id = s.id
             WHERE s.stream_key = $1 AND sd.is_active = true
             ORDER BY sd.domain`,
            [streamKey]
        );
        return result.rows;
    } catch (error) {
        logger.error('Error getting stream domains:', error);
        throw error;
    }
}

/**
 * Invalidate domain cache
 */
async function invalidateDomainCache(streamKey = null) {
    try {
        if (streamKey) {
            // Use SCAN instead of KEYS to avoid blocking Redis
            const keys = await redis.scan(`domain:${streamKey}:*`);
            for (const key of keys) {
                await redis.del(key);
            }
        } else {
            // Invalidate all domain caches
            const keys = await redis.scan('domain:*');
            for (const key of keys) {
                await redis.del(key);
            }
        }
    } catch (error) {
        logger.error('Error invalidating domain cache:', error);
    }
}

/**
 * Log access attempt
 */
async function logAccessAttempt(streamKey, action, ip, userAgent, referer, isAllowed, reason = null) {
    try {
        // Get stream ID
        let streamId = null;
        if (streamKey) {
            const streamResult = await db.query(
                'SELECT id FROM streams WHERE stream_key = $1',
                [streamKey]
            );
            if (streamResult.rows.length > 0) {
                streamId = streamResult.rows[0].id;
            }
        }

        await db.query(
            `INSERT INTO access_logs (stream_id, action, ip_address, user_agent, referer, is_allowed, reason)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [streamId, action, ip, userAgent, referer, isAllowed, reason]
        );
    } catch (error) {
        logger.error('Error logging access attempt:', error);
    }
}

/**
 * Get access logs for a stream
 */
async function getAccessLogs(streamKey, limit = 100, offset = 0) {
    try {
        const result = await db.query(
            `SELECT al.* FROM access_logs al
             JOIN streams s ON al.stream_id = s.id
             WHERE s.stream_key = $1
             ORDER BY al.created_at DESC
             LIMIT $2 OFFSET $3`,
            [streamKey, limit, offset]
        );
        return result.rows;
    } catch (error) {
        logger.error('Error getting access logs:', error);
        throw error;
    }
}

/**
 * Get blocked access attempts
 */
async function getBlockedAttempts(limit = 100, offset = 0) {
    try {
        const result = await db.query(
            `SELECT * FROM access_logs
             WHERE is_allowed = false
             ORDER BY created_at DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        return result.rows;
    } catch (error) {
        logger.error('Error getting blocked attempts:', error);
        throw error;
    }
}

module.exports = {
    isDomainAllowed,
    extractDomainFromReferer,
    normalizeDomain,
    addGlobalDomain,
    removeGlobalDomain,
    getGlobalDomains,
    addStreamDomain,
    removeStreamDomain,
    getStreamDomains,
    invalidateDomainCache,
    logAccessAttempt,
    getAccessLogs,
    getBlockedAttempts
};
