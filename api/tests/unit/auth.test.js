/**
 * Unit Tests for Authentication Middleware
 */

const jwt = require('jsonwebtoken');
const {
    verifyToken,
    optionalToken,
    requireAdmin,
    requireRole,
    generateToken,
    generateRefreshToken,
    verifyRefreshToken
} = require('../../src/middleware/auth');
const config = require('../../src/config');

describe('Authentication Middleware - verifyToken', () => {
    test('should verify valid JWT token with correct algorithm', () => {
        const user = { id: 1, username: 'testuser', email: 'test@example.com', role: 'admin' };
        const token = jwt.sign(user, config.jwt.secret, {
            algorithm: 'HS256',
            issuer: 'openstream-api',
            expiresIn: '1h'
        });

        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = {};
        const next = jest.fn();

        verifyToken(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.user).toBeDefined();
        expect(req.user.id).toBe(1);
        expect(req.user.username).toBe('testuser');
    });

    test('should reject token with missing authorization header', () => {
        const req = { headers: {} };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const next = jest.fn();

        verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Unauthorized',
            message: 'No authorization token provided'
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('should reject invalid authorization header format', () => {
        const req = { headers: { authorization: 'InvalidFormat' } };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const next = jest.fn();

        verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Unauthorized',
            message: 'Invalid authorization header format'
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('should reject token with wrong algorithm (algorithm substitution attack)', () => {
        // Attempt to create token with 'none' algorithm
        const maliciousToken = jwt.sign(
            { id: 999, username: 'hacker', role: 'admin' },
            '',  // Empty secret for 'none' algorithm
            { algorithm: 'none' }
        );

        const req = { headers: { authorization: `Bearer ${maliciousToken}` } };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const next = jest.fn();

        verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('should reject expired token', async () => {
        const token = jwt.sign(
            { id: 1, username: 'test' },
            config.jwt.secret,
            {
                expiresIn: '1ms',
                algorithm: 'HS256',
                issuer: 'openstream-api'
            }
        );

        // Wait for token to expire
        await new Promise(resolve => setTimeout(resolve, 10));

        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const next = jest.fn();

        verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Unauthorized',
            message: 'Token has expired'
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('should reject token with invalid signature', () => {
        const token = jwt.sign(
            { id: 1, username: 'test' },
            'wrong-secret',
            { algorithm: 'HS256', issuer: 'openstream-api' }
        );

        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const next = jest.fn();

        verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Unauthorized',
            message: 'Invalid token'
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('should reject token with wrong issuer', () => {
        const token = jwt.sign(
            { id: 1, username: 'test' },
            config.jwt.secret,
            { algorithm: 'HS256', issuer: 'malicious-issuer' }
        );

        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const next = jest.fn();

        verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });

    test('should reject malformed token', () => {
        const req = { headers: { authorization: 'Bearer invalid.token.here' } };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const next = jest.fn();

        verifyToken(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });
});

describe('Authentication Middleware - optionalToken', () => {
    test('should continue without token when no authorization header', () => {
        const req = { headers: {} };
        const res = {};
        const next = jest.fn();

        optionalToken(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.user).toBeUndefined();
    });

    test('should set user when valid token provided', () => {
        const user = { id: 1, username: 'testuser', role: 'user' };
        const token = jwt.sign(user, config.jwt.secret, {
            algorithm: 'HS256',
            issuer: 'openstream-api',
            expiresIn: '1h'
        });

        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = {};
        const next = jest.fn();

        optionalToken(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.user).toBeDefined();
        expect(req.user.username).toBe('testuser');
    });

    test('should continue without user when invalid token provided', () => {
        const req = { headers: { authorization: 'Bearer invalid.token' } };
        const res = {};
        const next = jest.fn();

        optionalToken(req, res, next);

        expect(next).toHaveBeenCalled();
        expect(req.user).toBeUndefined();
    });
});

describe('Authentication Middleware - requireAdmin', () => {
    test('should allow admin user', () => {
        const req = { user: { id: 1, username: 'admin', role: 'admin' } };
        const res = {};
        const next = jest.fn();

        requireAdmin(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    test('should reject non-admin user', () => {
        const req = { user: { id: 2, username: 'user', role: 'user' } };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const next = jest.fn();

        requireAdmin(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Forbidden',
            message: 'Admin access required'
        });
        expect(next).not.toHaveBeenCalled();
    });

    test('should reject unauthenticated request', () => {
        const req = {};
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const next = jest.fn();

        requireAdmin(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Unauthorized',
            message: 'Authentication required'
        });
        expect(next).not.toHaveBeenCalled();
    });
});

describe('Authentication Middleware - requireRole', () => {
    test('should allow user with required role', () => {
        const req = { user: { id: 1, username: 'moderator', role: 'moderator' } };
        const res = {};
        const next = jest.fn();
        const middleware = requireRole('moderator', 'admin');

        middleware(req, res, next);

        expect(next).toHaveBeenCalled();
    });

    test('should reject user without required role', () => {
        const req = { user: { id: 2, username: 'user', role: 'user' } };
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const next = jest.fn();
        const middleware = requireRole('moderator', 'admin');

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    test('should reject unauthenticated request', () => {
        const req = {};
        const res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        const next = jest.fn();
        const middleware = requireRole('admin');

        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
    });
});

describe('Token Generation and Verification', () => {
    test('should generate valid access token', () => {
        const user = {
            id: 1,
            username: 'testuser',
            email: 'test@example.com',
            role: 'user'
        };

        const token = generateToken(user);

        expect(token).toBeDefined();

        const decoded = jwt.verify(token, config.jwt.secret, {
            algorithms: ['HS256'],
            issuer: 'openstream-api'
        });

        expect(decoded.id).toBe(user.id);
        expect(decoded.username).toBe(user.username);
        expect(decoded.email).toBe(user.email);
        expect(decoded.role).toBe(user.role);
    });

    test('should generate valid refresh token', () => {
        const user = { id: 1, username: 'testuser' };

        const refreshToken = generateRefreshToken(user);

        expect(refreshToken).toBeDefined();

        const decoded = jwt.verify(refreshToken, config.jwt.secret, {
            algorithms: ['HS256'],
            issuer: 'openstream-api'
        });

        expect(decoded.id).toBe(user.id);
        expect(decoded.type).toBe('refresh');
    });

    test('should verify valid refresh token', () => {
        const user = { id: 1 };
        const refreshToken = generateRefreshToken(user);

        const decoded = verifyRefreshToken(refreshToken);

        expect(decoded).toBeDefined();
        expect(decoded.id).toBe(user.id);
        expect(decoded.type).toBe('refresh');
    });

    test('should reject access token as refresh token', () => {
        const user = { id: 1, username: 'testuser', email: 'test@example.com', role: 'user' };
        const accessToken = generateToken(user);

        const decoded = verifyRefreshToken(accessToken);

        expect(decoded).toBeNull();
    });

    test('should reject invalid refresh token', () => {
        const invalidToken = 'invalid.token.here';

        const decoded = verifyRefreshToken(invalidToken);

        expect(decoded).toBeNull();
    });

    test('should reject expired refresh token', async () => {
        const token = jwt.sign(
            { id: 1, type: 'refresh' },
            config.jwt.secret,
            {
                expiresIn: '1ms',
                algorithm: 'HS256',
                issuer: 'openstream-api'
            }
        );

        await new Promise(resolve => setTimeout(resolve, 10));

        const decoded = verifyRefreshToken(token);

        expect(decoded).toBeNull();
    });
});
