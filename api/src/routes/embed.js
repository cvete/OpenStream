/**
 * Secure Embed Player Routes
 */

const express = require('express');
const router = express.Router();

const db = require('../services/database');
const logger = require('../services/logger');
const tokenService = require('../services/tokenService');
const domainService = require('../services/domainService');

/**
 * GET /embed/:streamKey
 * Render secure embed player
 */
router.get('/:streamKey', async (req, res) => {
    try {
        const { streamKey } = req.params;
        const referer = req.headers.referer;
        const viewerIp = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip;

        // Get stream info
        const streamResult = await db.query(
            `SELECT id, name, status FROM streams
             WHERE stream_key = $1 AND is_active = true`,
            [streamKey]
        );

        if (streamResult.rows.length === 0) {
            return res.status(404).send(renderErrorPage('Stream Not Found', 'The requested stream does not exist.'));
        }

        const stream = streamResult.rows[0];

        // Check domain allowance
        const refererDomain = domainService.extractDomainFromReferer(referer);
        const isDomainAllowed = await domainService.isDomainAllowed(streamKey, refererDomain);

        if (!isDomainAllowed) {
            logger.warn(`Embed rejected for ${streamKey}: Domain ${refererDomain} not allowed`);
            await domainService.logAccessAttempt(
                streamKey, 'embed', viewerIp, req.headers['user-agent'], referer, false, 'Domain not allowed'
            );
            return res.status(403).send(renderErrorPage('Access Denied', 'This stream is not authorized for playback on this domain.'));
        }

        // Generate playback token
        const tokenData = tokenService.generatePlaybackToken(streamKey, null, 4);

        // Log successful access
        await domainService.logAccessAttempt(
            streamKey, 'embed', viewerIp, req.headers['user-agent'], referer, true
        );

        // Render player page
        res.send(renderPlayerPage(stream, streamKey, tokenData));

    } catch (error) {
        logger.error('Embed error:', error);
        res.status(500).send(renderErrorPage('Error', 'An error occurred while loading the player.'));
    }
});

/**
 * GET /embed/:streamKey/token
 * Get a fresh playback token (for token refresh)
 */
router.get('/:streamKey/token', async (req, res) => {
    try {
        const { streamKey } = req.params;
        const referer = req.headers.referer;
        const viewerIp = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.ip;

        // Verify stream exists
        const streamResult = await db.query(
            `SELECT id FROM streams WHERE stream_key = $1 AND is_active = true`,
            [streamKey]
        );

        if (streamResult.rows.length === 0) {
            return res.status(404).json({ error: 'Stream not found' });
        }

        // Check domain
        const refererDomain = domainService.extractDomainFromReferer(referer);
        const isDomainAllowed = await domainService.isDomainAllowed(streamKey, refererDomain);

        if (!isDomainAllowed) {
            return res.status(403).json({ error: 'Domain not allowed' });
        }

        // Generate new token
        const tokenData = tokenService.generatePlaybackToken(streamKey, null, 4);

        res.json({
            token: tokenData.token,
            expires: tokenData.expires,
            playbackUrl: `/live/${streamKey}.m3u8?token=${tokenData.token}&expires=${tokenData.expires}`
        });

    } catch (error) {
        logger.error('Token refresh error:', error);
        res.status(500).json({ error: 'Failed to generate token' });
    }
});

/**
 * Render the player HTML page
 */
function renderPlayerPage(stream, streamKey, tokenData) {
    const playbackUrl = `/live/${streamKey}.m3u8?token=${tokenData.token}&expires=${tokenData.expires}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(stream.name)} - Live Stream</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        html, body {
            width: 100%;
            height: 100%;
            background: #000;
            overflow: hidden;
        }
        #player-container {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        video {
            width: 100%;
            height: 100%;
            max-width: 100%;
            max-height: 100%;
        }
        .offline-message {
            color: #fff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            text-align: center;
            padding: 20px;
        }
        .offline-message h2 {
            margin-bottom: 10px;
            font-size: 24px;
        }
        .offline-message p {
            color: #999;
            font-size: 16px;
        }
        .loading {
            color: #fff;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .error-message {
            color: #ff4444;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            text-align: center;
            padding: 20px;
        }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@1.4.12/dist/hls.min.js"></script>
</head>
<body>
    <div id="player-container">
        ${stream.status === 'live' ? `
        <video id="video" controls autoplay playsinline></video>
        ` : `
        <div class="offline-message">
            <h2>${escapeHtml(stream.name)}</h2>
            <p>This stream is currently offline</p>
        </div>
        `}
    </div>

    ${stream.status === 'live' ? `
    <script>
        const streamKey = '${escapeJs(streamKey)}';
        let playbackUrl = '${escapeJs(playbackUrl)}';
        let tokenExpires = ${tokenData.expires};
        let hls = null;

        // Initialize player
        function initPlayer() {
            const video = document.getElementById('video');

            if (Hls.isSupported()) {
                hls = new Hls({
                    maxBufferLength: 30,
                    maxMaxBufferLength: 60,
                    liveSyncDurationCount: 3,
                    liveMaxLatencyDurationCount: 10
                });

                hls.loadSource(playbackUrl);
                hls.attachMedia(video);

                hls.on(Hls.Events.MANIFEST_PARSED, function() {
                    video.play().catch(e => console.log('Autoplay prevented:', e));
                });

                hls.on(Hls.Events.ERROR, function(event, data) {
                    if (data.fatal) {
                        switch (data.type) {
                            case Hls.ErrorTypes.NETWORK_ERROR:
                                console.log('Network error, trying to recover...');
                                hls.startLoad();
                                break;
                            case Hls.ErrorTypes.MEDIA_ERROR:
                                console.log('Media error, trying to recover...');
                                hls.recoverMediaError();
                                break;
                            default:
                                console.log('Fatal error:', data);
                                showError('Playback error occurred');
                                break;
                        }
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                // Native HLS support (Safari)
                video.src = playbackUrl;
                video.addEventListener('loadedmetadata', function() {
                    video.play().catch(e => console.log('Autoplay prevented:', e));
                });
            } else {
                showError('HLS playback is not supported in this browser');
            }
        }

        // Refresh token before expiration
        async function refreshToken() {
            try {
                const response = await fetch('/embed/${escapeJs(streamKey)}/token');
                const data = await response.json();

                if (data.playbackUrl) {
                    playbackUrl = data.playbackUrl;
                    tokenExpires = data.expires;

                    // Reload HLS source with new token
                    if (hls) {
                        hls.loadSource(playbackUrl);
                    }
                }
            } catch (error) {
                console.error('Failed to refresh token:', error);
            }
        }

        // Check and refresh token periodically
        function scheduleTokenRefresh() {
            const now = Math.floor(Date.now() / 1000);
            const timeUntilExpiry = tokenExpires - now;

            // Refresh 5 minutes before expiry
            const refreshIn = Math.max((timeUntilExpiry - 300) * 1000, 60000);

            setTimeout(async () => {
                await refreshToken();
                scheduleTokenRefresh();
            }, refreshIn);
        }

        function showError(message) {
            const container = document.getElementById('player-container');
            container.innerHTML = '<div class="error-message"><p>' + message + '</p></div>';
        }

        // Initialize
        document.addEventListener('DOMContentLoaded', function() {
            initPlayer();
            scheduleTokenRefresh();
        });
    </script>
    ` : ''}
</body>
</html>`;
}

/**
 * Render error page
 */
function renderErrorPage(title, message) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        html, body {
            width: 100%;
            height: 100%;
            background: #1a1a1a;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .error-container {
            text-align: center;
            padding: 40px;
            color: #fff;
        }
        h1 {
            font-size: 48px;
            margin-bottom: 20px;
            color: #ff4444;
        }
        p {
            font-size: 18px;
            color: #999;
        }
    </style>
</head>
<body>
    <div class="error-container">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
    </div>
</body>
</html>`;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Escape JavaScript string
 */
function escapeJs(str) {
    if (!str) return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

module.exports = router;
