/**
 * Application Configuration
 */

module.exports = {
    // Server
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    isDevelopment: process.env.NODE_ENV !== 'production',
    isProduction: process.env.NODE_ENV === 'production',

    // Database
    database: {
        url: process.env.DATABASE_URL || 'postgresql://streaming:streaming_password@localhost:5432/streaming_db',
        pool: {
            min: 2,
            max: 10
        }
    },

    // Redis
    redis: {
        url: process.env.REDIS_URL || 'redis://localhost:6379'
    },

    // JWT Authentication
    jwt: {
        secret: process.env.JWT_SECRET || 'your-jwt-secret-change-in-production',
        expiresIn: process.env.JWT_EXPIRES_IN || '24h',
        refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
    },

    // Stream Token (for playback security)
    token: {
        secret: process.env.TOKEN_SECRET || 'your-super-secret-token-key-change-in-production',
        expiryHours: parseInt(process.env.TOKEN_EXPIRY_HOURS) || 4
    },

    // SRS Configuration
    srs: {
        apiUrl: process.env.SRS_API_URL || 'http://localhost:1985',
        rtmpPort: process.env.SRS_RTMP_PORT || 1935
    },

    // Media paths
    media: {
        basePath: process.env.MEDIA_PATH || '/media',
        livePath: process.env.MEDIA_LIVE_PATH || '/media/live',
        vodPath: process.env.MEDIA_VOD_PATH || '/media/vod'
    },

    // Security settings
    security: {
        bcryptRounds: 10,
        streamKeyLength: 20,
        maxLoginAttempts: 5,
        lockoutDuration: 15 * 60 * 1000 // 15 minutes
    },

    // Rate limiting
    rateLimit: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100 // requests per window
    },

    // Streaming defaults
    streaming: {
        maxViewersPerStream: parseInt(process.env.MAX_VIEWERS_PER_STREAM) || 5000,
        defaultTokenExpiry: 4, // hours
        segmentDuration: 2, // seconds
        playlistSize: 6 // segments
    }
};
