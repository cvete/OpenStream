/**
 * Integration Tests for Stream Lifecycle
 * Tests the complete flow: create stream -> publish -> status check -> unpublish
 */

const request = require('supertest');
const express = require('express');
const db = require('../../src/services/database');
const redis = require('../../src/services/redis');
const { generateToken } = require('../../src/middleware/auth');

// Import routes
const authRoutes = require('../../src/routes/auth');
const streamsRoutes = require('../../src/routes/streams');
const hooksRoutes = require('../../src/routes/hooks');

// Create test app
const app = express();
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/streams', streamsRoutes);
app.use('/api/hooks', hooksRoutes);

describe('Stream Lifecycle Integration Tests', () => {
    let authToken;
    let testUser;
    let streamId;
    let streamKey;

    beforeAll(async () => {
        // Initialize database connection
        await db.initDatabase();

        // Create test user
        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash('testpassword', 10);

        const userResult = await db.query(
            `INSERT INTO users (username, email, password_hash, role)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (username) DO UPDATE SET email = $2
             RETURNING *`,
            ['testuser', 'test@example.com', hashedPassword, 'admin']
        );

        testUser = userResult.rows[0];
        authToken = generateToken(testUser);
    });

    afterAll(async () => {
        // Clean up test data
        if (streamId) {
            await db.query('DELETE FROM streams WHERE id = $1', [streamId]);
        }
        await db.query('DELETE FROM users WHERE username = $1', ['testuser']);

        // Close connections
        if (db.pool) {
            await db.pool.end();
        }
    });

    beforeEach(async () => {
        // Clear Redis before each test
        if (redis.client && redis.client.isOpen) {
            await redis.client.flushDb();
        }
    });

    describe('Stream Creation', () => {
        test('should create a new stream', async () => {
            const res = await request(app)
                .post('/api/streams')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: 'Integration Test Stream',
                    description: 'This is a test stream for integration testing'
                })
                .expect(201);

            expect(res.body.stream).toBeDefined();
            expect(res.body.stream.name).toBe('Integration Test Stream');
            expect(res.body.stream.description).toBe('This is a test stream for integration testing');
            expect(res.body.stream.stream_key).toMatch(/^[a-zA-Z0-9]{20,32}$/);
            expect(res.body.stream.status).toBe('offline');

            // Save for other tests
            streamId = res.body.stream.id;
            streamKey = res.body.stream.stream_key;
        });

        test('should reject stream creation without authentication', async () => {
            await request(app)
                .post('/api/streams')
                .send({
                    name: 'Unauthorized Stream'
                })
                .expect(401);
        });

        test('should reject stream creation without name', async () => {
            const res = await request(app)
                .post('/api/streams')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    description: 'No name provided'
                })
                .expect(400);

            expect(res.body.error).toBe('Validation Error');
        });
    });

    describe('Stream Publishing', () => {
        test('should publish stream via webhook', async () => {
            const res = await request(app)
                .post('/api/hooks/publish')
                .send({
                    action: 'on_publish',
                    client_id: '12345',
                    ip: '127.0.0.1',
                    vhost: '__defaultVhost__',
                    app: 'live',
                    stream: streamKey,
                    param: '',
                    tcUrl: `rtmp://localhost/live/${streamKey}`
                })
                .expect(200);

            expect(res.body.code).toBe(0);

            // Verify stream status in database
            const result = await db.query(
                'SELECT * FROM streams WHERE stream_key = $1',
                [streamKey]
            );

            expect(result.rows[0].status).toBe('live');
            expect(result.rows[0].started_at).toBeDefined();
        });

        test('should reject publish for non-existent stream', async () => {
            const res = await request(app)
                .post('/api/hooks/publish')
                .send({
                    action: 'on_publish',
                    client_id: '12345',
                    ip: '127.0.0.1',
                    app: 'live',
                    stream: 'nonexistent_stream_key'
                })
                .expect(403);

            expect(res.body.code).toBe(1);
            expect(res.body.message).toContain('Invalid stream key');
        });

        test('should reject duplicate publish on already live stream', async () => {
            // First publish - should succeed
            await request(app)
                .post('/api/hooks/publish')
                .send({
                    action: 'on_publish',
                    client_id: '12345',
                    ip: '127.0.0.1',
                    app: 'live',
                    stream: streamKey
                })
                .expect(200);

            // Second publish - should be rejected
            const res = await request(app)
                .post('/api/hooks/publish')
                .send({
                    action: 'on_publish',
                    client_id: '67890',
                    ip: '127.0.0.1',
                    app: 'live',
                    stream: streamKey
                })
                .expect(403);

            expect(res.body.code).toBe(1);
            expect(res.body.message).toContain('already live');
        });
    });

    describe('Stream Status Check', () => {
        test('should show stream as live after publishing', async () => {
            // Publish the stream first
            await request(app)
                .post('/api/hooks/publish')
                .send({
                    action: 'on_publish',
                    client_id: '12345',
                    ip: '127.0.0.1',
                    app: 'live',
                    stream: streamKey
                })
                .expect(200);

            // Check stream status
            const res = await request(app)
                .get(`/api/streams/${streamId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.status).toBe('live');
            expect(res.body.started_at).toBeDefined();
            expect(res.body.stream_key).toBe(streamKey);
        });

        test('should list live streams', async () => {
            // Publish the stream
            await request(app)
                .post('/api/hooks/publish')
                .send({
                    action: 'on_publish',
                    client_id: '12345',
                    ip: '127.0.0.1',
                    app: 'live',
                    stream: streamKey
                })
                .expect(200);

            // List all streams
            const res = await request(app)
                .get('/api/streams?status=live')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.streams).toBeDefined();
            expect(Array.isArray(res.body.streams)).toBe(true);

            const liveStream = res.body.streams.find(s => s.stream_key === streamKey);
            expect(liveStream).toBeDefined();
            expect(liveStream.status).toBe('live');
        });
    });

    describe('Stream Unpublishing', () => {
        test('should unpublish stream', async () => {
            // First publish the stream
            await request(app)
                .post('/api/hooks/publish')
                .send({
                    action: 'on_publish',
                    client_id: '12345',
                    ip: '127.0.0.1',
                    app: 'live',
                    stream: streamKey
                })
                .expect(200);

            // Then unpublish
            const res = await request(app)
                .post('/api/hooks/unpublish')
                .send({
                    action: 'on_unpublish',
                    client_id: '12345',
                    ip: '127.0.0.1',
                    app: 'live',
                    stream: streamKey
                })
                .expect(200);

            expect(res.body.code).toBe(0);

            // Verify stream status in database
            const result = await db.query(
                'SELECT * FROM streams WHERE stream_key = $1',
                [streamKey]
            );

            expect(result.rows[0].status).toBe('offline');
            expect(result.rows[0].ended_at).toBeDefined();
        });

        test('should show stream as offline after unpublishing', async () => {
            // Publish
            await request(app)
                .post('/api/hooks/publish')
                .send({
                    action: 'on_publish',
                    client_id: '12345',
                    ip: '127.0.0.1',
                    app: 'live',
                    stream: streamKey
                });

            // Unpublish
            await request(app)
                .post('/api/hooks/unpublish')
                .send({
                    action: 'on_unpublish',
                    client_id: '12345',
                    ip: '127.0.0.1',
                    app: 'live',
                    stream: streamKey
                });

            // Check status
            const res = await request(app)
                .get(`/api/streams/${streamId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.status).toBe('offline');
            expect(res.body.ended_at).toBeDefined();
        });

        test('should handle unpublish for non-existent stream gracefully', async () => {
            const res = await request(app)
                .post('/api/hooks/unpublish')
                .send({
                    action: 'on_unpublish',
                    client_id: '12345',
                    ip: '127.0.0.1',
                    app: 'live',
                    stream: 'nonexistent_key'
                })
                .expect(200);

            expect(res.body.code).toBe(0);
        });
    });

    describe('Complete Stream Lifecycle', () => {
        test('should handle complete lifecycle: create -> publish -> unpublish -> republish', async () => {
            // 1. Create stream
            const createRes = await request(app)
                .post('/api/streams')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: 'Lifecycle Test Stream',
                    description: 'Full lifecycle test'
                })
                .expect(201);

            const testStreamKey = createRes.body.stream.stream_key;
            const testStreamId = createRes.body.stream.id;

            // 2. Publish
            await request(app)
                .post('/api/hooks/publish')
                .send({
                    action: 'on_publish',
                    client_id: '12345',
                    ip: '127.0.0.1',
                    app: 'live',
                    stream: testStreamKey
                })
                .expect(200);

            let statusRes = await request(app)
                .get(`/api/streams/${testStreamId}`)
                .set('Authorization', `Bearer ${authToken}`);
            expect(statusRes.body.status).toBe('live');

            // 3. Unpublish
            await request(app)
                .post('/api/hooks/unpublish')
                .send({
                    action: 'on_unpublish',
                    client_id: '12345',
                    ip: '127.0.0.1',
                    app: 'live',
                    stream: testStreamKey
                })
                .expect(200);

            statusRes = await request(app)
                .get(`/api/streams/${testStreamId}`)
                .set('Authorization', `Bearer ${authToken}`);
            expect(statusRes.body.status).toBe('offline');

            // 4. Republish (should work)
            await request(app)
                .post('/api/hooks/publish')
                .send({
                    action: 'on_publish',
                    client_id: '67890',
                    ip: '127.0.0.1',
                    app: 'live',
                    stream: testStreamKey
                })
                .expect(200);

            statusRes = await request(app)
                .get(`/api/streams/${testStreamId}`)
                .set('Authorization', `Bearer ${authToken}`);
            expect(statusRes.body.status).toBe('live');

            // Cleanup
            await db.query('DELETE FROM streams WHERE id = $1', [testStreamId]);
        });
    });
});
