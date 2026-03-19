/**
 * Streaming Server API - Main Entry Point
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const logger = require('./services/logger');
const database = require('./services/database');
const redisService = require('./services/redis');
const { initSentry, initSentryErrorHandler } = require('./services/sentry');

// Import routes
const authRoutes = require('./routes/auth');
const streamsRoutes = require('./routes/streams');
const vodRoutes = require('./routes/vod');
const statsRoutes = require('./routes/stats');
const hooksRoutes = require('./routes/hooks');
const internalRoutes = require('./routes/internal');
const embedRoutes = require('./routes/embed');
const domainsRoutes = require('./routes/domains');
const settingsRoutes = require('./routes/settings');
const auditRoutes = require('./routes/audit');

const app = express();

// Initialize Sentry FIRST (must be before other middleware)
initSentry(app);

// Trust proxy (for rate limiting behind NGINX)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
            frameSrc: ["'self'", ...(config.cors.allowedOrigins || [])],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: []
        }
    },
    crossOriginEmbedderPolicy: false,  // Keep disabled for embed player
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
    }
}));

// CORS configuration
app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);

        // Check whitelist
        if (config.cors.allowedOrigins.length === 0) {
            // Development mode - allow all if no origins configured
            if (config.isDevelopment) {
                return callback(null, true);
            }
            // Production - require explicit whitelist
            logger.warn(`CORS rejected: No allowed origins configured, origin: ${origin}`);
            return callback(new Error('Not allowed by CORS'));
        }

        if (config.cors.allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            logger.warn(`CORS rejected: Unauthorized origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// Compression
app.use(compression());

// Request logging
app.use(morgan('combined', {
    stream: { write: message => logger.info(message.trim()) }
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Global rate limiting
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // Limit each IP to 1000 requests per windowMs
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});
app.use(globalLimiter);

// Strict rate limit for authentication endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per window
    message: { error: 'Too many login attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true  // Only count failed attempts
});

// Apply strict limiter to auth routes
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/streams', streamsRoutes);
app.use('/api/vod', vodRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/hooks', hooksRoutes);
app.use('/api/internal', internalRoutes);
app.use('/api/domains', domainsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/config', settingsRoutes);
app.use('/api/audit', auditRoutes);
app.use('/embed', embedRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.path} not found`
    });
});

// Sentry error handler (must be after routes but before other error handlers)
initSentryErrorHandler(app);

// Error handler
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);

    res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error',
        ...(config.isDevelopment && { stack: err.stack })
    });
});

// Initialize services and start server
async function startServer() {
    try {
        // Initialize database
        await database.initDatabase();
        logger.info('Database connected');

        // Initialize Redis
        await redisService.initRedis();
        logger.info('Redis connected');

        // Start HTTP server
        const PORT = config.port || 3000;
        server = app.listen(PORT, '0.0.0.0', () => {
            logger.info(`Streaming API server running on port ${PORT}`);
            logger.info(`Environment: ${config.nodeEnv}`);
        });

    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}

// Server reference for graceful shutdown
let server = null;

// Handle graceful shutdown
async function gracefulShutdown(signal) {
    logger.info(`${signal} received, shutting down gracefully`);

    const forceTimeout = setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
    }, 30000);

    try {
        // 1. Stop accepting new connections
        if (server) {
            await new Promise((resolve) => server.close(resolve));
            logger.info('HTTP server closed');
        }

        // 2. Close Redis
        await redisService.disconnect();

        // 3. Close database pool
        await database.close();

        clearTimeout(forceTimeout);
        process.exit(0);
    } catch (error) {
        logger.error('Error during shutdown:', error);
        clearTimeout(forceTimeout);
        process.exit(1);
    }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start the server
startServer();

module.exports = app;
