/**
 * PostgreSQL Database Service
 */

const { Pool } = require('pg');
const config = require('../config');
const logger = require('./logger');

let pool = null;

/**
 * Initialize database connection pool
 */
async function initDatabase() {
    pool = new Pool({
        connectionString: config.database.url,
        min: config.database.pool.min,
        max: config.database.pool.max,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
    });

    // Test connection
    const client = await pool.connect();
    try {
        await client.query('SELECT NOW()');
        logger.info('Database connection established');
    } finally {
        client.release();
    }

    // Handle pool errors
    pool.on('error', (err) => {
        logger.error('Unexpected database pool error:', err);
    });

    return pool;
}

/**
 * Get database pool
 */
function getPool() {
    if (!pool) {
        throw new Error('Database not initialized');
    }
    return pool;
}

/**
 * Execute a query with performance monitoring
 */
async function query(text, params) {
    const start = Date.now();
    const queryPreview = text.replace(/\s+/g, ' ').trim().substring(0, 100);

    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;

        // Log slow queries (>1 second)
        if (duration > 1000) {
            logger.warn('Slow query detected', {
                duration: `${duration}ms`,
                query: queryPreview,
                rows: result.rowCount,
                params: params ? `${params.length} params` : 'no params'
            });

            // Send to Sentry if configured
            if (process.env.SENTRY_DSN) {
                const Sentry = require('@sentry/node');
                Sentry.captureMessage(`Slow query: ${duration}ms`, {
                    level: 'warning',
                    contexts: {
                        database: {
                            query: queryPreview,
                            duration,
                            rows: result.rowCount
                        }
                    }
                });
            }
        }

        // Debug log for all queries in development
        if (config.isDevelopment && duration > 100) {
            logger.debug(`Query executed in ${duration}ms: ${queryPreview}`);
        }

        // Collect metrics (can integrate with Prometheus/DataDog later)
        if (process.env.NODE_ENV === 'production') {
            // Track query performance metrics
            const queryType = text.trim().split(' ')[0].toUpperCase();
            collectQueryMetric(queryType, duration, result.rowCount);
        }

        return result;
    } catch (error) {
        const duration = Date.now() - start;

        logger.error('Database query error', {
            query: queryPreview,
            duration: `${duration}ms`,
            error: error.message,
            code: error.code
        });

        // Send to Sentry if configured
        if (process.env.SENTRY_DSN) {
            const Sentry = require('@sentry/node');
            Sentry.captureException(error, {
                contexts: {
                    database: {
                        query: queryPreview,
                        duration,
                        code: error.code
                    }
                }
            });
        }

        throw error;
    }
}

/**
 * Collect query performance metrics
 * Can be extended to send to monitoring services
 */
function collectQueryMetric(queryType, duration, rowCount) {
    // Store metrics in memory for periodic reporting
    if (!global.queryMetrics) {
        global.queryMetrics = {
            queries: {},
            lastReset: Date.now()
        };
    }

    if (!global.queryMetrics.queries[queryType]) {
        global.queryMetrics.queries[queryType] = {
            count: 0,
            totalDuration: 0,
            avgDuration: 0,
            maxDuration: 0,
            minDuration: Infinity,
            totalRows: 0
        };
    }

    const metrics = global.queryMetrics.queries[queryType];
    metrics.count++;
    metrics.totalDuration += duration;
    metrics.avgDuration = metrics.totalDuration / metrics.count;
    metrics.maxDuration = Math.max(metrics.maxDuration, duration);
    metrics.minDuration = Math.min(metrics.minDuration, duration);
    metrics.totalRows += rowCount;

    // Reset metrics every hour
    const hourInMs = 60 * 60 * 1000;
    if (Date.now() - global.queryMetrics.lastReset > hourInMs) {
        logger.info('Query performance metrics (last hour)', global.queryMetrics.queries);
        global.queryMetrics = {
            queries: {},
            lastReset: Date.now()
        };
    }
}

/**
 * Get current query performance metrics
 */
function getQueryMetrics() {
    return global.queryMetrics || { queries: {}, lastReset: Date.now() };
}

/**
 * Get a client from the pool for transactions
 */
async function getClient() {
    return await pool.connect();
}

/**
 * Execute a transaction
 */
async function transaction(callback) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    initDatabase,
    getPool,
    query,
    getClient,
    transaction,
    getQueryMetrics,
    pool
};
