/**
 * Audit Logging Service
 * Tracks admin actions and critical system events for security and compliance
 */

const db = require('./database');
const logger = require('./logger');

/**
 * Log an audit event
 *
 * @param {number} userId - ID of the user performing the action
 * @param {string} action - Action performed (e.g., 'stream.create', 'user.delete')
 * @param {string} resourceType - Type of resource (e.g., 'stream', 'user', 'domain')
 * @param {string} resourceId - ID of the resource affected
 * @param {object} changes - Object containing changes (for updates: { before: {}, after: {} })
 * @param {object} req - Express request object (for IP, user agent)
 * @param {object} metadata - Additional context data
 */
async function logAudit(userId, action, resourceType, resourceId, changes = null, req = null, metadata = null) {
    try {
        await db.query(
            `INSERT INTO audit_logs (user_id, action, resource_type, resource_id, ip_address, user_agent, changes, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
                userId,
                action,
                resourceType,
                resourceId,
                req ? req.ip : null,
                req ? req.headers['user-agent'] : null,
                changes ? JSON.stringify(changes) : null,
                metadata ? JSON.stringify(metadata) : null
            ]
        );

        logger.info('Audit log recorded', {
            userId,
            action,
            resourceType,
            resourceId,
            ip: req?.ip
        });

        return true;
    } catch (error) {
        // Never throw on audit failure - log and continue
        logger.error('Failed to record audit log:', error);
        return false;
    }
}

/**
 * Get audit logs with filtering and pagination
 *
 * @param {object} filters - Filter criteria
 * @param {number} filters.userId - Filter by user ID
 * @param {string} filters.action - Filter by action
 * @param {string} filters.resourceType - Filter by resource type
 * @param {string} filters.resourceId - Filter by resource ID
 * @param {Date} filters.startDate - Filter by start date
 * @param {Date} filters.endDate - Filter by end date
 * @param {number} limit - Number of records to return
 * @param {number} offset - Offset for pagination
 */
async function getAuditLogs(filters = {}, limit = 100, offset = 0) {
    try {
        const conditions = [];
        const params = [];
        let paramIndex = 1;

        if (filters.userId) {
            conditions.push(`user_id = $${paramIndex}`);
            params.push(filters.userId);
            paramIndex++;
        }

        if (filters.action) {
            conditions.push(`action = $${paramIndex}`);
            params.push(filters.action);
            paramIndex++;
        }

        if (filters.resourceType) {
            conditions.push(`resource_type = $${paramIndex}`);
            params.push(filters.resourceType);
            paramIndex++;
        }

        if (filters.resourceId) {
            conditions.push(`resource_id = $${paramIndex}`);
            params.push(filters.resourceId);
            paramIndex++;
        }

        if (filters.startDate) {
            conditions.push(`created_at >= $${paramIndex}`);
            params.push(filters.startDate);
            paramIndex++;
        }

        if (filters.endDate) {
            conditions.push(`created_at <= $${paramIndex}`);
            params.push(filters.endDate);
            paramIndex++;
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        const query = `
            SELECT
                al.*,
                u.username,
                u.email
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            ${whereClause}
            ORDER BY al.created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        params.push(limit, offset);

        const result = await db.query(query, params);

        // Get total count
        const countQuery = `SELECT COUNT(*) FROM audit_logs ${whereClause}`;
        const countResult = await db.query(countQuery, params.slice(0, -2));

        return {
            logs: result.rows,
            total: parseInt(countResult.rows[0].count),
            limit,
            offset
        };
    } catch (error) {
        logger.error('Error fetching audit logs:', error);
        throw error;
    }
}

/**
 * Get audit logs for a specific user
 */
async function getUserAuditLogs(userId, limit = 100, offset = 0) {
    return getAuditLogs({ userId }, limit, offset);
}

/**
 * Get audit logs for a specific resource
 */
async function getResourceAuditLogs(resourceType, resourceId, limit = 100, offset = 0) {
    return getAuditLogs({ resourceType, resourceId }, limit, offset);
}

/**
 * Get recent audit logs (last 24 hours by default)
 */
async function getRecentAuditLogs(hours = 24, limit = 100) {
    const startDate = new Date(Date.now() - hours * 60 * 60 * 1000);
    return getAuditLogs({ startDate }, limit, 0);
}

/**
 * Get audit log statistics
 */
async function getAuditStats(startDate = null, endDate = null) {
    try {
        const conditions = [];
        const params = [];

        if (startDate) {
            conditions.push(`created_at >= $1`);
            params.push(startDate);
        }

        if (endDate) {
            conditions.push(`created_at <= $${params.length + 1}`);
            params.push(endDate);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Get action counts
        const actionStatsQuery = `
            SELECT action, COUNT(*) as count
            FROM audit_logs
            ${whereClause}
            GROUP BY action
            ORDER BY count DESC
        `;

        const actionStats = await db.query(actionStatsQuery, params);

        // Get user activity
        const userStatsQuery = `
            SELECT
                al.user_id,
                u.username,
                COUNT(*) as action_count
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            ${whereClause}
            GROUP BY al.user_id, u.username
            ORDER BY action_count DESC
            LIMIT 10
        `;

        const userStats = await db.query(userStatsQuery, params);

        // Get resource type counts
        const resourceStatsQuery = `
            SELECT resource_type, COUNT(*) as count
            FROM audit_logs
            ${whereClause}
            GROUP BY resource_type
            ORDER BY count DESC
        `;

        const resourceStats = await db.query(resourceStatsQuery, params);

        return {
            actionStats: actionStats.rows,
            userStats: userStats.rows,
            resourceStats: resourceStats.rows
        };
    } catch (error) {
        logger.error('Error fetching audit stats:', error);
        throw error;
    }
}

/**
 * Clean up old audit logs (for maintenance)
 */
async function cleanupOldAuditLogs(daysToKeep = 90) {
    try {
        const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

        const result = await db.query(
            'DELETE FROM audit_logs WHERE created_at < $1',
            [cutoffDate]
        );

        logger.info(`Cleaned up ${result.rowCount} old audit logs (older than ${daysToKeep} days)`);

        return result.rowCount;
    } catch (error) {
        logger.error('Error cleaning up audit logs:', error);
        throw error;
    }
}

module.exports = {
    logAudit,
    getAuditLogs,
    getUserAuditLogs,
    getResourceAuditLogs,
    getRecentAuditLogs,
    getAuditStats,
    cleanupOldAuditLogs
};
