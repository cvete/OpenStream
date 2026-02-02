/**
 * Audit Logs API Routes
 * Admin-only access to audit trail
 */

const express = require('express');
const router = express.Router();

const { verifyToken, requireAdmin } = require('../middleware/auth');
const auditLogger = require('../services/auditLogger');
const logger = require('../services/logger');

/**
 * GET /api/audit
 * Get audit logs with filtering
 */
router.get('/', verifyToken, requireAdmin, async (req, res) => {
    try {
        const {
            userId,
            action,
            resourceType,
            resourceId,
            startDate,
            endDate,
            limit = 100,
            offset = 0
        } = req.query;

        const filters = {};

        if (userId) filters.userId = parseInt(userId);
        if (action) filters.action = action;
        if (resourceType) filters.resourceType = resourceType;
        if (resourceId) filters.resourceId = resourceId;
        if (startDate) filters.startDate = new Date(startDate);
        if (endDate) filters.endDate = new Date(endDate);

        const result = await auditLogger.getAuditLogs(
            filters,
            Math.min(parseInt(limit), 1000),
            parseInt(offset)
        );

        res.json({
            logs: result.logs,
            pagination: {
                total: result.total,
                limit: result.limit,
                offset: result.offset,
                hasMore: result.offset + result.limit < result.total
            }
        });

    } catch (error) {
        logger.error('Error fetching audit logs:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to fetch audit logs'
        });
    }
});

/**
 * GET /api/audit/user/:userId
 * Get audit logs for a specific user
 */
router.get('/user/:userId', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit = 100, offset = 0 } = req.query;

        const result = await auditLogger.getUserAuditLogs(
            parseInt(userId),
            Math.min(parseInt(limit), 1000),
            parseInt(offset)
        );

        res.json({
            logs: result.logs,
            pagination: {
                total: result.total,
                limit: result.limit,
                offset: result.offset,
                hasMore: result.offset + result.limit < result.total
            }
        });

    } catch (error) {
        logger.error('Error fetching user audit logs:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to fetch user audit logs'
        });
    }
});

/**
 * GET /api/audit/resource/:resourceType/:resourceId
 * Get audit logs for a specific resource
 */
router.get('/resource/:resourceType/:resourceId', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { resourceType, resourceId } = req.params;
        const { limit = 100, offset = 0 } = req.query;

        const result = await auditLogger.getResourceAuditLogs(
            resourceType,
            resourceId,
            Math.min(parseInt(limit), 1000),
            parseInt(offset)
        );

        res.json({
            logs: result.logs,
            pagination: {
                total: result.total,
                limit: result.limit,
                offset: result.offset,
                hasMore: result.offset + result.limit < result.total
            }
        });

    } catch (error) {
        logger.error('Error fetching resource audit logs:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to fetch resource audit logs'
        });
    }
});

/**
 * GET /api/audit/recent
 * Get recent audit logs (last 24 hours by default)
 */
router.get('/recent', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { hours = 24, limit = 100 } = req.query;

        const result = await auditLogger.getRecentAuditLogs(
            parseInt(hours),
            Math.min(parseInt(limit), 1000)
        );

        res.json({
            logs: result.logs,
            total: result.total,
            hours: parseInt(hours)
        });

    } catch (error) {
        logger.error('Error fetching recent audit logs:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to fetch recent audit logs'
        });
    }
});

/**
 * GET /api/audit/stats
 * Get audit log statistics
 */
router.get('/stats', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        const stats = await auditLogger.getAuditStats(
            startDate ? new Date(startDate) : null,
            endDate ? new Date(endDate) : null
        );

        res.json(stats);

    } catch (error) {
        logger.error('Error fetching audit stats:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to fetch audit statistics'
        });
    }
});

module.exports = router;
