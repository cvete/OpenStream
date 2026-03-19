/**
 * Authentication Routes
 */

const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();

const db = require('../services/database');
const redis = require('../services/redis');
const logger = require('../services/logger');
const auditLogger = require('../services/auditLogger');
const config = require('../config');
const {
    verifyToken,
    generateToken,
    generateRefreshToken,
    verifyRefreshToken
} = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const {
    handleValidationErrors,
    validateUsername,
    validatePassword,
    validateEmail
} = require('../middleware/validation');

/**
 * POST /api/auth/login
 * Admin login
 */
router.post('/login',
    validateUsername(),
    handleValidationErrors,
    async (req, res) => {
        try {
            const { username, password } = req.body;

            // Basic password presence check (don't validate strength on login)
            if (!password) {
                return res.status(400).json({
                    error: 'Validation Error',
                    message: 'Password is required'
                });
            }

        // Check account lockout (degrades gracefully if Redis is down)
        const attempts = await redis.getLoginAttempts(username);
        if (attempts >= config.security.maxLoginAttempts) {
            logger.warn(`Account locked out: ${username} (${attempts} failed attempts)`);
            return res.status(429).json({
                error: 'Too Many Requests',
                message: 'Account temporarily locked due to too many failed login attempts. Try again later.'
            });
        }

        // Find user
        const result = await db.query(
            `SELECT * FROM users WHERE username = $1 AND is_active = true`,
            [username]
        );

        if (result.rows.length === 0) {
            await redis.incrementLoginAttempts(username);
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid credentials'
            });
        }

        const user = result.rows[0];

        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            await redis.incrementLoginAttempts(username);
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid credentials'
            });
        }

        // Clear lockout counter on successful login
        await redis.clearLoginAttempts(username);

        // Update last login
        await db.query(
            `UPDATE users SET last_login = NOW() WHERE id = $1`,
            [user.id]
        );

        // Generate tokens
        const token = generateToken(user);
        const refreshToken = generateRefreshToken(user);

        logger.info(`User ${username} logged in`);

        // Log audit trail
        await auditLogger.logAudit(
            user.id,
            'auth.login',
            'user',
            user.id.toString(),
            null,
            req
        );

        res.json({
            message: 'Login successful',
            token,
            refreshToken,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        logger.error('Login error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Login failed'
        });
    }
});

/**
 * POST /api/auth/refresh
 * Refresh access token
 */
router.post('/refresh', [
    body('refreshToken').notEmpty().withMessage('Refresh token is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const { refreshToken } = req.body;

        // Verify refresh token
        const decoded = verifyRefreshToken(refreshToken);
        if (!decoded) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid refresh token'
            });
        }

        // Get user
        const result = await db.query(
            `SELECT * FROM users WHERE id = $1 AND is_active = true`,
            [decoded.id]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'User not found'
            });
        }

        const user = result.rows[0];

        // Generate new tokens
        const newToken = generateToken(user);
        const newRefreshToken = generateRefreshToken(user);

        res.json({
            token: newToken,
            refreshToken: newRefreshToken
        });

    } catch (error) {
        logger.error('Token refresh error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Token refresh failed'
        });
    }
});

/**
 * GET /api/auth/me
 * Get current user info
 */
router.get('/me', verifyToken, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, username, email, role, created_at, last_login
             FROM users WHERE id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        res.json(result.rows[0]);

    } catch (error) {
        logger.error('Get user error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Failed to get user info'
        });
    }
});

/**
 * PUT /api/auth/password
 * Change password
 */
router.put('/password', verifyToken, [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const { currentPassword, newPassword } = req.body;

        // Get user
        const result = await db.query(
            `SELECT password_hash FROM users WHERE id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: 'User not found'
            });
        }

        // Verify current password
        const isValid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
        if (!isValid) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Current password is incorrect'
            });
        }

        // Hash new password
        const newHash = await bcrypt.hash(newPassword, config.security.bcryptRounds);

        // Update password
        await db.query(
            `UPDATE users SET password_hash = $1 WHERE id = $2`,
            [newHash, req.user.id]
        );

        logger.info(`User ${req.user.username} changed password`);

        res.json({
            message: 'Password changed successfully'
        });

    } catch (error) {
        logger.error('Password change error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Password change failed'
        });
    }
});

/**
 * POST /api/auth/logout
 * Revoke current access token
 */
router.post('/logout', verifyToken, async (req, res) => {
    try {
        if (req.user.jti) {
            // Calculate remaining TTL from token expiry
            const expiresAt = req.user.exp;
            const now = Math.floor(Date.now() / 1000);
            const ttl = Math.max(expiresAt - now, 0);

            if (ttl > 0) {
                await redis.blacklistToken(req.user.jti, ttl);
            }
        }

        logger.info(`User ${req.user.username} logged out`);
        res.json({ message: 'Logged out successfully' });
    } catch (error) {
        logger.error('Logout error:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: 'Logout failed'
        });
    }
});

module.exports = router;
