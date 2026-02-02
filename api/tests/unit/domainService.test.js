/**
 * Unit Tests for Domain Service
 */

const domainService = require('../../src/services/domainService');
const db = require('../../src/services/database');
const redis = require('../../src/services/redis');

// Mock the database and redis modules
jest.mock('../../src/services/database');
jest.mock('../../src/services/logger');

describe('Domain Service - normalizeDomain', () => {
    test('should normalize domain by lowercasing', () => {
        expect(domainService.normalizeDomain('Example.COM')).toBe('example.com');
    });

    test('should remove www prefix', () => {
        expect(domainService.normalizeDomain('www.example.com')).toBe('example.com');
    });

    test('should handle both www and uppercase', () => {
        expect(domainService.normalizeDomain('WWW.Example.COM')).toBe('example.com');
    });

    test('should handle null input', () => {
        expect(domainService.normalizeDomain(null)).toBeNull();
    });

    test('should handle undefined input', () => {
        expect(domainService.normalizeDomain(undefined)).toBeNull();
    });

    test('should preserve subdomain', () => {
        expect(domainService.normalizeDomain('sub.example.com')).toBe('sub.example.com');
    });
});

describe('Domain Service - extractDomainFromReferer', () => {
    test('should extract domain from HTTP URL', () => {
        expect(domainService.extractDomainFromReferer('http://example.com/page')).toBe('example.com');
    });

    test('should extract domain from HTTPS URL', () => {
        expect(domainService.extractDomainFromReferer('https://example.com/page')).toBe('example.com');
    });

    test('should extract domain with subdomain', () => {
        expect(domainService.extractDomainFromReferer('https://www.example.com/page')).toBe('www.example.com');
    });

    test('should extract domain with port', () => {
        expect(domainService.extractDomainFromReferer('https://example.com:8080/page')).toBe('example.com');
    });

    test('should handle null referer', () => {
        expect(domainService.extractDomainFromReferer(null)).toBeNull();
    });

    test('should handle invalid URL', () => {
        expect(domainService.extractDomainFromReferer('not-a-url')).toBeNull();
    });

    test('should handle empty string', () => {
        expect(domainService.extractDomainFromReferer('')).toBeNull();
    });
});

describe('Domain Service - isDomainAllowed', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Reset Redis mock
        redis.get = jest.fn().mockResolvedValue(null);
        redis.set = jest.fn().mockResolvedValue('OK');
    });

    test('should allow when no referer domain (direct access)', async () => {
        const allowed = await domainService.isDomainAllowed('stream123', null);
        expect(allowed).toBe(true);
    });

    test('should return cached result when available', async () => {
        redis.get = jest.fn().mockResolvedValue(true);

        const allowed = await domainService.isDomainAllowed('stream123', 'example.com');

        expect(allowed).toBe(true);
        expect(redis.get).toHaveBeenCalledWith('domain:stream123:example.com');
        expect(db.query).not.toHaveBeenCalled();
    });

    test('should check global domains when not cached', async () => {
        redis.get = jest.fn().mockResolvedValue(null);
        db.query = jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // Global domain found

        const allowed = await domainService.isDomainAllowed('stream123', 'example.com');

        expect(allowed).toBe(true);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('FROM global_domains'),
            ['example.com']
        );
        expect(redis.set).toHaveBeenCalledWith('domain:stream123:example.com', true, 300);
    });

    test('should check wildcard global domains', async () => {
        redis.get = jest.fn().mockResolvedValue(null);
        db.query = jest.fn()
            .mockResolvedValueOnce({ rows: [] }) // No exact global match
            .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // Wildcard match found

        const allowed = await domainService.isDomainAllowed('stream123', 'sub.example.com');

        expect(allowed).toBe(true);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('LIKE REPLACE'),
            ['sub.example.com']
        );
    });

    test('should check stream-specific domains when global not found', async () => {
        redis.get = jest.fn().mockResolvedValue(null);
        db.query = jest.fn()
            .mockResolvedValueOnce({ rows: [] }) // No global match
            .mockResolvedValueOnce({ rows: [] }) // No wildcard global match
            .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // Stream found
            .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // Stream domain match

        const allowed = await domainService.isDomainAllowed('stream123', 'example.com');

        expect(allowed).toBe(true);
        expect(db.query).toHaveBeenCalledWith(
            'SELECT id FROM streams WHERE stream_key = $1',
            ['stream123']
        );
    });

    test('should deny when stream not found', async () => {
        redis.get = jest.fn().mockResolvedValue(null);
        db.query = jest.fn()
            .mockResolvedValueOnce({ rows: [] }) // No global match
            .mockResolvedValueOnce({ rows: [] }) // No wildcard global match
            .mockResolvedValueOnce({ rows: [] }); // Stream not found

        const allowed = await domainService.isDomainAllowed('nonexistent', 'example.com');

        expect(allowed).toBe(false);
        expect(redis.set).toHaveBeenCalledWith('domain:nonexistent:example.com', false, 300);
    });

    test('should deny when no matching domains found', async () => {
        redis.get = jest.fn().mockResolvedValue(null);
        db.query = jest.fn()
            .mockResolvedValueOnce({ rows: [] }) // No global match
            .mockResolvedValueOnce({ rows: [] }) // No wildcard global match
            .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // Stream found
            .mockResolvedValueOnce({ rows: [] }) // No stream domain match
            .mockResolvedValueOnce({ rows: [] }); // No wildcard stream match

        const allowed = await domainService.isDomainAllowed('stream123', 'evil.com');

        expect(allowed).toBe(false);
        expect(redis.set).toHaveBeenCalledWith('domain:stream123:evil.com', false, 300);
    });

    test('should be permissive on database error', async () => {
        redis.get = jest.fn().mockResolvedValue(null);
        db.query = jest.fn().mockRejectedValue(new Error('Database error'));

        const allowed = await domainService.isDomainAllowed('stream123', 'example.com');

        expect(allowed).toBe(true);
    });

    test('should normalize domain before checking', async () => {
        redis.get = jest.fn().mockResolvedValue(null);
        db.query = jest.fn()
            .mockResolvedValueOnce({ rows: [{ id: 1 }] });

        await domainService.isDomainAllowed('stream123', 'WWW.Example.COM');

        expect(redis.get).toHaveBeenCalledWith('domain:stream123:example.com');
        expect(db.query).toHaveBeenCalledWith(
            expect.any(String),
            ['example.com']
        );
    });
});

describe('Domain Service - addGlobalDomain', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        redis.scan = jest.fn().mockResolvedValue([]);
        redis.del = jest.fn().mockResolvedValue(1);
    });

    test('should add global domain with normalization', async () => {
        const mockDomain = { id: 1, domain: 'example.com', description: 'Test domain', is_active: true };
        db.query = jest.fn().mockResolvedValue({ rows: [mockDomain] });

        const result = await domainService.addGlobalDomain('WWW.Example.COM', 'Test domain');

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('INSERT INTO global_domains'),
            ['example.com', 'Test domain']
        );
        expect(result).toEqual(mockDomain);
    });

    test('should invalidate cache after adding domain', async () => {
        const mockDomain = { id: 1, domain: 'example.com' };
        db.query = jest.fn().mockResolvedValue({ rows: [mockDomain] });
        redis.scan = jest.fn().mockResolvedValue(['domain:stream1:example.com', 'domain:stream2:example.com']);

        await domainService.addGlobalDomain('example.com');

        expect(redis.scan).toHaveBeenCalledWith('domain:*');
        expect(redis.del).toHaveBeenCalled();
    });

    test('should handle database error', async () => {
        db.query = jest.fn().mockRejectedValue(new Error('Database error'));

        await expect(domainService.addGlobalDomain('example.com')).rejects.toThrow('Database error');
    });
});

describe('Domain Service - removeGlobalDomain', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        redis.scan = jest.fn().mockResolvedValue([]);
        redis.del = jest.fn().mockResolvedValue(1);
    });

    test('should remove global domain', async () => {
        const mockDomain = { id: 1, domain: 'example.com', is_active: false };
        db.query = jest.fn().mockResolvedValue({ rows: [mockDomain] });

        const result = await domainService.removeGlobalDomain('example.com');

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE global_domains SET is_active = false'),
            ['example.com']
        );
        expect(result).toEqual(mockDomain);
    });

    test('should invalidate cache after removing domain', async () => {
        const mockDomain = { id: 1, domain: 'example.com' };
        db.query = jest.fn().mockResolvedValue({ rows: [mockDomain] });
        redis.scan = jest.fn().mockResolvedValue(['domain:stream1:example.com']);

        await domainService.removeGlobalDomain('example.com');

        expect(redis.scan).toHaveBeenCalledWith('domain:*');
        expect(redis.del).toHaveBeenCalled();
    });
});

describe('Domain Service - getGlobalDomains', () => {
    test('should retrieve all active global domains', async () => {
        const mockDomains = [
            { id: 1, domain: 'example.com', is_active: true },
            { id: 2, domain: 'test.com', is_active: true }
        ];
        db.query = jest.fn().mockResolvedValue({ rows: mockDomains });

        const result = await domainService.getGlobalDomains();

        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining('WHERE is_active = true ORDER BY domain')
        );
        expect(result).toEqual(mockDomains);
    });
});

describe('Domain Service - invalidateDomainCache', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        redis.scan = jest.fn().mockResolvedValue([]);
        redis.del = jest.fn().mockResolvedValue(1);
    });

    test('should invalidate cache for specific stream', async () => {
        redis.scan = jest.fn().mockResolvedValue([
            'domain:stream123:example.com',
            'domain:stream123:test.com'
        ]);

        await domainService.invalidateDomainCache('stream123');

        expect(redis.scan).toHaveBeenCalledWith('domain:stream123:*');
        expect(redis.del).toHaveBeenCalledTimes(2);
    });

    test('should invalidate all domain caches when no stream specified', async () => {
        redis.scan = jest.fn().mockResolvedValue([
            'domain:stream1:example.com',
            'domain:stream2:test.com'
        ]);

        await domainService.invalidateDomainCache();

        expect(redis.scan).toHaveBeenCalledWith('domain:*');
        expect(redis.del).toHaveBeenCalledTimes(2);
    });

    test('should handle Redis errors gracefully', async () => {
        redis.scan = jest.fn().mockRejectedValue(new Error('Redis error'));

        // Should not throw
        await expect(domainService.invalidateDomainCache()).resolves.not.toThrow();
    });
});
