/**
 * Authentication Middleware
 */

const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../services/logger');
const redis = require('../services/redis');

/**
 * Verify JWT token middleware
 */
async function verifyToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'No authorization token provided'
        });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid authorization header format'
        });
    }

    const token = parts[1];

    try {
        const decoded = jwt.verify(token, config.jwt.secret, {
            algorithms: ['HS256'],  // Prevent algorithm substitution attacks
            issuer: 'openstream-api',
            maxAge: '24h'
        });

        // Check if token has been revoked (degrades gracefully if Redis is down)
        if (decoded.jti) {
            const blacklisted = await redis.isTokenBlacklisted(decoded.jti);
            if (blacklisted) {
                return res.status(401).json({
                    error: 'Unauthorized',
                    message: 'Token has been revoked'
                });
            }
        }

        req.user = decoded;
        next();
    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Token has expired'
            });
        }

        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Invalid token'
            });
        }

        logger.error('Token verification error:', error);
        return res.status(500).json({
            error: 'Internal Server Error',
            message: 'Token verification failed'
        });
    }
}

/**
 * Optional token verification (doesn't fail if no token)
 */
function optionalToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return next();
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return next();
    }

    const token = parts[1];

    try {
        const decoded = jwt.verify(token, config.jwt.secret, {
            algorithms: ['HS256'],
            issuer: 'openstream-api',
            maxAge: '24h'
        });
        req.user = decoded;
    } catch (error) {
        // Ignore token errors for optional auth
    }

    next();
}

/**
 * Check if user has admin role
 */
function requireAdmin(req, res, next) {
    if (!req.user) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'Authentication required'
        });
    }

    if (req.user.role !== 'admin') {
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Admin access required'
        });
    }

    next();
}

/**
 * Check if user has specific role(s)
 */
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'Authentication required'
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `Required role: ${roles.join(' or ')}`
            });
        }

        next();
    };
}

/**
 * Generate JWT token
 */
function generateToken(user) {
    return jwt.sign(
        {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            jti: uuidv4()
        },
        config.jwt.secret,
        {
            expiresIn: config.jwt.expiresIn,
            algorithm: 'HS256',
            issuer: 'openstream-api'
        }
    );
}

/**
 * Generate refresh token
 */
function generateRefreshToken(user) {
    return jwt.sign(
        {
            id: user.id,
            type: 'refresh'
        },
        config.jwt.secret,
        {
            expiresIn: config.jwt.refreshExpiresIn,
            algorithm: 'HS256',
            issuer: 'openstream-api'
        }
    );
}

/**
 * Verify refresh token
 */
function verifyRefreshToken(token) {
    try {
        const decoded = jwt.verify(token, config.jwt.secret, {
            algorithms: ['HS256'],
            issuer: 'openstream-api'
        });
        if (decoded.type !== 'refresh') {
            return null;
        }
        return decoded;
    } catch (error) {
        return null;
    }
}

module.exports = {
    verifyToken,
    optionalToken,
    requireAdmin,
    requireRole,
    generateToken,
    generateRefreshToken,
    verifyRefreshToken
};
