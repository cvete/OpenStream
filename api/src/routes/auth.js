/**
 * Authentication Routes
 */

const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const router = express.Router();

const db = require('../services/database');
const logger = require('../services/logger');
const config = require('../config');
const {
    verifyToken,
    generateToken,
    generateRefreshToken,
    verifyRefreshToken
} = require('../middleware/auth');

/**
 * POST /api/auth/login
 * Admin login
 */
router.post('/login', [
    body('username').trim().notEmpty().withMessage('Username is required'),
    body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation Error',
                details: errors.array()
            });
        }

        const { username, password } = req.body;

        // Find user
        const result = await db.query(
            `SELECT * FROM users WHERE username = $1 AND is_active = true`,
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid credentials'
            });
        }

        const user = result.rows[0];

        // Verify password
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid credentials'
            });
        }

        // Update last login
        await db.query(
            `UPDATE users SET last_login = NOW() WHERE id = $1`,
            [user.id]
        );

        // Generate tokens
        const token = generateToken(user);
        const refreshToken = generateRefreshToken(user);

        logger.info(`User ${username} logged in`);

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

module.exports = router;
