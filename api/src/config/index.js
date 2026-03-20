/**
 * Application Configuration
 */

/**
 * Validate production configuration
 */
function validateProductionConfig() {
    if (process.env.NODE_ENV === 'production') {
        const required = [
            'DATABASE_URL',
            'REDIS_URL',
            'JWT_SECRET',
            'TOKEN_SECRET'
        ];

        const missing = required.filter(key => !process.env[key]);

        if (missing.length > 0) {
            console.error('❌ CRITICAL: Missing required environment variables:');
            missing.forEach(key => console.error(`   - ${key}`));
            console.error('\nApplication cannot start without these variables.');
            process.exit(1);
        }

        // Validate secret strength
        const secrets = ['JWT_SECRET', 'TOKEN_SECRET'];
        secrets.forEach(key => {
            const value = process.env[key];
            if (value.length < 32) {
                console.error(`❌ CRITICAL: ${key} must be at least 32 characters (current: ${value.length})`);
                process.exit(1);
            }
            if (value.includes('change-in-production') || value.includes('your-')) {
                console.error(`❌ CRITICAL: ${key} still contains default value`);
                process.exit(1);
            }
        });

        // Validate CORS configuration in production
        if (!process.env.ALLOWED_ORIGINS) {
            console.error('⚠️  WARNING: ALLOWED_ORIGINS not set in production. CORS will reject all requests.');
        }

        console.log('✅ Production configuration validated');
    }
}

// Run validation before exporting config
validateProductionConfig();

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
        rtmpPort: process.env.SRS_RTMP_PORT || 1935,
        webhookSecret: process.env.SRS_WEBHOOK_SECRET,
        webhookIpWhitelist: process.env.SRS_WEBHOOK_IP_WHITELIST
            ? process.env.SRS_WEBHOOK_IP_WHITELIST.split(',').map(ip => ip.trim())
            : ['127.0.0.1', '::1', '::ffff:127.0.0.1']
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
    },

    // Transcoding
    transcoding: {
        maxConcurrent: parseInt(process.env.MAX_CONCURRENT_TRANSCODES) || 5,
        srsRtmpUrl: process.env.SRS_RTMP_URL || 'rtmp://srs:1935',
        masterPlaylistDir: process.env.MEDIA_LIVE_PATH || '/media/live',
        defaultProfiles: (process.env.DEFAULT_TRANSCODING_PROFILES || '720p,480p,360p').split(','),
        retryAttempts: 3,
        retryDelays: [10000, 30000, 60000],
        gracefulStopTimeout: 5000
    },

    // CORS Configuration
    cors: {
        allowedOrigins: process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : []
    }
};
