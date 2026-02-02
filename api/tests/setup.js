const redis = require('../src/services/redis');

// Test environment configuration
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/streaming_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/1';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-32-characters-minimum-length';
process.env.PORT = '0'; // Random port for testing

// Global test timeout
jest.setTimeout(10000);

beforeAll(async () => {
    // Initialize Redis connection for tests
    try {
        await redis.initRedis();
    } catch (error) {
        console.warn('Redis connection failed in tests:', error.message);
    }
});

afterAll(async () => {
    // Clean up Redis connection
    try {
        if (redis.client && redis.client.isOpen) {
            await redis.client.quit();
        }
    } catch (error) {
        console.warn('Redis cleanup failed:', error.message);
    }
});

beforeEach(async () => {
    // Clear Redis test database before each test
    try {
        if (redis.client && redis.client.isOpen) {
            await redis.client.flushDb();
        }
    } catch (error) {
        console.warn('Redis flush failed:', error.message);
    }
});
