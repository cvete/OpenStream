/**
 * Domain Management Routes
 * For hotlinking and domain protection
 */

const express = require('express');
const { body, param, validationResult } = require('express-validator');
const router = express.Router();

const domainService = require('../services/domainService');
const logger = require('../services/logger');
const { verifyToken, requireAdmin } = require('../middleware/auth');

/**
 * GET /api/domains/global
 * Get all global allowed domains
 */
router.get('/global', verifyToken, async (req, res) => {
    try {
        const domains = await domainService.getGlobalDomains();
        res.json({ domains });
    } catch (error) {
        logger.error('Error getting global domains:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get global domains'
        });
    }
});

/**
 * POST /api/domains/global
 * Add a global allowed domain
 */
router.post('/global', verifyToken, requireAdmin, [
    body('domain').trim().notEmpty().withMessage('Domain is required'),
    body('description').optional().trim()
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const { domain, description } = req.body;

        const result = await domainService.addGlobalDomain(domain, description);

        logger.info(`Global domain added: ${domain} by ${req.user.username}`);

        res.status(201).json({
            message: 'Domain added successfully',
            domain: result
        });

    } catch (error) {
        logger.error('Error adding global domain:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to add domain'
        });
    }
});

/**
 * DELETE /api/domains/global/:domain
 * Remove a global allowed domain
 */
router.delete('/global/:domain', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { domain } = req.params;

        const result = await domainService.removeGlobalDomain(domain);

        if (!result) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Domain not found'
            });
        }

        logger.info(`Global domain removed: ${domain} by ${req.user.username}`);

        res.json({
            message: 'Domain removed successfully'
        });

    } catch (error) {
        logger.error('Error removing global domain:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to remove domain'
        });
    }
});

/**
 * GET /api/domains/stream/:streamKey
 * Get allowed domains for a specific stream
 */
router.get('/stream/:streamKey', verifyToken, async (req, res) => {
    try {
        const { streamKey } = req.params;

        const domains = await domainService.getStreamDomains(streamKey);

        res.json({ domains });

    } catch (error) {
        logger.error('Error getting stream domains:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get stream domains'
        });
    }
});

/**
 * POST /api/domains/stream/:streamKey
 * Add an allowed domain for a specific stream
 */
router.post('/stream/:streamKey', verifyToken, [
    body('domain').trim().notEmpty().withMessage('Domain is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const { streamKey } = req.params;
        const { domain } = req.body;

        const result = await domainService.addStreamDomain(streamKey, domain);

        logger.info(`Stream domain added: ${domain} for ${streamKey} by ${req.user.username}`);

        res.status(201).json({
            message: 'Domain added successfully',
            domain: result
        });

    } catch (error) {
        if (error.message === 'Stream not found') {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Stream not found'
            });
        }

        logger.error('Error adding stream domain:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to add domain'
        });
    }
});

/**
 * DELETE /api/domains/stream/:streamKey/:domain
 * Remove an allowed domain from a specific stream
 */
router.delete('/stream/:streamKey/:domain', verifyToken, async (req, res) => {
    try {
        const { streamKey, domain } = req.params;

        const result = await domainService.removeStreamDomain(streamKey, domain);

        if (!result) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Domain not found for this stream'
            });
        }

        logger.info(`Stream domain removed: ${domain} from ${streamKey} by ${req.user.username}`);

        res.json({
            message: 'Domain removed successfully'
        });

    } catch (error) {
        if (error.message === 'Stream not found') {
            return res.status(404).json({
                error: 'Not Found',
                message: 'Stream not found'
            });
        }

        logger.error('Error removing stream domain:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to remove domain'
        });
    }
});

/**
 * POST /api/domains/check
 * Check if a domain is allowed (for testing)
 */
router.post('/check', verifyToken, [
    body('streamKey').trim().notEmpty().withMessage('Stream key is required'),
    body('domain').trim().notEmpty().withMessage('Domain is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const { streamKey, domain } = req.body;

        const isAllowed = await domainService.isDomainAllowed(streamKey, domain);

        res.json({
            stream_key: streamKey,
            domain: domain,
            allowed: isAllowed
        });

    } catch (error) {
        logger.error('Error checking domain:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to check domain'
        });
    }
});

/**
 * GET /api/domains/logs
 * Get access logs (blocked/allowed attempts)
 */
router.get('/logs', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 50, blocked_only = false } = req.query;

        let logs;
        if (blocked_only === 'true') {
            logs = await domainService.getBlockedAttempts(parseInt(limit), (parseInt(page) - 1) * limit);
        } else {
            // Get all logs (would need a new function in domainService)
            logs = await domainService.getBlockedAttempts(parseInt(limit), (parseInt(page) - 1) * limit);
        }

        res.json({
            logs,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit)
            }
        });

    } catch (error) {
        logger.error('Error getting domain logs:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get logs'
        });
    }
});

/**
 * POST /api/domains/invalidate-cache
 * Invalidate domain cache (for immediate effect after changes)
 */
router.post('/invalidate-cache', verifyToken, requireAdmin, async (req, res) => {
    try {
        const { streamKey } = req.body;

        await domainService.invalidateDomainCache(streamKey);

        logger.info(`Domain cache invalidated ${streamKey ? `for ${streamKey}` : '(all)'} by ${req.user.username}`);

        res.json({
            message: 'Cache invalidated successfully'
        });

    } catch (error) {
        logger.error('Error invalidating cache:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to invalidate cache'
        });
    }
});

module.exports = router;
