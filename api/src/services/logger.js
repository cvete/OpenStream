/**
 * Logger Service using Winston
 */

const winston = require('winston');
const config = require('../config');

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Custom log format
const logFormat = printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level}]: ${stack || message}`;
});

// Create logger instance
const logger = winston.createLogger({
    level: config.isDevelopment ? 'debug' : 'info',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
    ),
    transports: [
        // Console transport
        new winston.transports.Console({
            format: combine(
                colorize(),
                timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                logFormat
            )
        })
    ],
    // Don't exit on handled exceptions
    exitOnError: false
});

// Add file transport in production
if (config.isProduction) {
    logger.add(new winston.transports.File({
        filename: '/var/log/streaming-api/error.log',
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5
    }));

    logger.add(new winston.transports.File({
        filename: '/var/log/streaming-api/combined.log',
        maxsize: 5242880, // 5MB
        maxFiles: 5
    }));
}

module.exports = logger;
