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
 * Execute a query
 */
async function query(text, params) {
    const start = Date.now();
    try {
        const result = await pool.query(text, params);
        const duration = Date.now() - start;
        logger.debug(`Query executed in ${duration}ms: ${text.substring(0, 100)}`);
        return result;
    } catch (error) {
        logger.error('Database query error:', error);
        throw error;
    }
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
    transaction
};
