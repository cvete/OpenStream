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
    const isWhitelisted = whitelist.some(allowedIp => {
        // Handle CIDR notation for /8, /16, /24 subnets
        if (allowedIp.includes('/')) {
            const [subnet, bits] = allowedIp.split('/');
            const subnetPrefix = subnet.split('.').slice(0, parseInt(bits) / 8).join('.');
            return clientIp.startsWith(subnetPrefix);
        }
        // Exact match
        return clientIp === allowedIp || clientIp === `::ffff:${allowedIp}`;
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
