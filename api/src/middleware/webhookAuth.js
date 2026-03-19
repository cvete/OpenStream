/**
 * Webhook Authentication Middleware
 * Protects SRS webhook endpoints from unauthorized access
 */

const crypto = require('crypto');
const config = require('../config');
const logger = require('../services/logger');

/**
 * Verify webhook signature and IP whitelist
 */
function verifyWebhookSignature(req, res, next) {
    // Method 1: IP Whitelist (simplest and most reliable for SRS)
    const clientIp = req.ip || req.connection.remoteAddress;
    const whitelist = config.srs.webhookIpWhitelist || ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

    // Check if IP is whitelisted
    const ipToNum = (ip) => ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
    const normalizeIp = (ip) => ip.replace(/^::ffff:/, '');

    const normalizedClientIp = normalizeIp(clientIp);

    const isWhitelisted = whitelist.some(allowedIp => {
        // Handle CIDR notation (supports all masks /1 through /32)
        if (allowedIp.includes('/')) {
            const [subnet, bits] = allowedIp.split('/');
            const maskBits = parseInt(bits);
            if (maskBits < 0 || maskBits > 32) return false;
            const mask = maskBits === 0 ? 0 : (~(2 ** (32 - maskBits) - 1)) >>> 0;
            return (ipToNum(normalizedClientIp) & mask) === (ipToNum(subnet) & mask);
        }
        // Exact match (handle IPv6-mapped IPv4)
        return normalizedClientIp === normalizeIp(allowedIp);
    });

    if (!isWhitelisted) {
        logger.warn(`Webhook rejected from unauthorized IP: ${clientIp}`);
        return res.status(403).json({ code: 1, error: 'Forbidden' });
    }

    // Method 2: HMAC Signature (if SRS supports custom headers)
    const signature = req.headers['x-srs-signature'];
    if (signature && config.srs.webhookSecret) {
        const expectedSig = crypto
            .createHmac('sha256', config.srs.webhookSecret)
            .update(JSON.stringify(req.body))
            .digest('hex');

        if (signature !== expectedSig) {
            logger.warn('Webhook signature mismatch', { clientIp });
            return res.status(403).json({ code: 1, error: 'Invalid signature' });
        }
    }

    next();
}

module.exports = { verifyWebhookSignature };
