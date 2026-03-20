/**
 * Restream Manager
 * Manages FFmpeg processes that pull external streams and push to SRS via RTMP
 */

const { spawn } = require('child_process');
const db = require('./database');
const logger = require('./logger');

// Active FFmpeg processes: Map<streamId, { process, streamKey, sourceUrl, startedAt, retries }>
const processes = new Map();

const MAX_RETRIES = 3;
const RETRY_DELAYS = [10000, 30000, 60000]; // 10s, 30s, 60s

/**
 * Start pulling an external stream and pushing to SRS
 */
async function startRestream(streamId, streamKey, sourceUrl) {
    // Check if already running
    if (processes.has(streamId)) {
        const existing = processes.get(streamId);
        if (existing.process && !existing.process.killed) {
            throw new Error('Restream already running for this stream');
        }
    }

    const srsUrl = `rtmp://srs:1935/live/${streamKey}`;

    logger.info(`Starting restream: ${sourceUrl} -> ${srsUrl}`);

    // Detect source type to use appropriate FFmpeg flags
    const isHls = /\.m3u8/i.test(sourceUrl);

    const ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'info',
        ...(isHls ? [
            // HLS: -re throttles to realtime (no effect on live HLS, prevents
            // VOD HLS from being read at max speed and finishing in seconds)
            '-re',
            '-rw_timeout', '15000000',
            '-multiple_requests', '1',
        ] : [
            // HTTP/RTMP: reconnect on transport-level failures
            '-reconnect', '1',
            '-reconnect_streamed', '1',
            '-reconnect_delay_max', '30',
            '-rw_timeout', '10000000',
        ]),
        '-i', sourceUrl,
        '-c', 'copy',
        '-f', 'flv',
        '-flvflags', 'no_duration_filesize',
        srsUrl
    ];

    const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const entry = {
        process: ffmpeg,
        streamKey,
        sourceUrl,
        startedAt: new Date(),
        retries: 0,
        lastError: null,
        intentionallyStopped: false
    };

    processes.set(streamId, entry);

    // Update database
    await db.query(
        `UPDATE streams SET restream_source_url = $1, restream_status = 'pulling', restream_error = NULL WHERE id = $2`,
        [sourceUrl, streamId]
    );

    let stderrBuffer = '';

    ffmpeg.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
            stderrBuffer = line; // Keep last line for error reporting
            // Log errors/warnings at info level, progress at debug
            if (/error|fail|refused|denied|timeout|broken/i.test(line)) {
                logger.warn(`FFmpeg [${streamKey}]: ${line}`);
            } else {
                logger.info(`FFmpeg [${streamKey}]: ${line}`);
            }
        }
    });

    ffmpeg.stdout.on('data', (data) => {
        logger.debug(`FFmpeg stdout [${streamKey}]: ${data.toString().trim()}`);
    });

    ffmpeg.on('close', async (code) => {
        const currentEntry = processes.get(streamId);
        if (!currentEntry || currentEntry.intentionallyStopped) {
            processes.delete(streamId);
            return;
        }

        if (code !== 0) {
            logger.warn(`FFmpeg exited with code ${code} for stream ${streamKey}`);

            // Check if we should retry
            if (currentEntry.retries < MAX_RETRIES) {
                const delay = RETRY_DELAYS[currentEntry.retries] || 60000;
                currentEntry.retries++;
                logger.info(`Retrying restream ${streamKey} in ${delay / 1000}s (attempt ${currentEntry.retries}/${MAX_RETRIES})`);

                await db.query(
                    `UPDATE streams SET restream_error = $1 WHERE id = $2`,
                    [`Retrying (${currentEntry.retries}/${MAX_RETRIES}): ${stderrBuffer}`, streamId]
                );

                setTimeout(async () => {
                    try {
                        const entry = processes.get(streamId);
                        if (entry && !entry.intentionallyStopped) {
                            processes.delete(streamId);
                            await startRestream(streamId, streamKey, sourceUrl);
                            // Preserve retry count
                            const newEntry = processes.get(streamId);
                            if (newEntry) {
                                newEntry.retries = currentEntry.retries;
                            }
                        }
                    } catch (err) {
                        logger.error(`Failed to retry restream ${streamKey}:`, err.message);
                    }
                }, delay);
            } else {
                // Max retries reached
                logger.error(`Restream ${streamKey} failed after ${MAX_RETRIES} retries`);
                await db.query(
                    `UPDATE streams SET restream_status = 'error', restream_error = $1 WHERE id = $2`,
                    [stderrBuffer || `FFmpeg exited with code ${code}`, streamId]
                );
                processes.delete(streamId);
            }
        } else {
            // Clean exit
            await db.query(
                `UPDATE streams SET restream_status = 'stopped' WHERE id = $1`,
                [streamId]
            );
            processes.delete(streamId);
        }
    });

    ffmpeg.on('error', async (err) => {
        logger.error(`FFmpeg spawn error for ${streamKey}:`, err.message);
        await db.query(
            `UPDATE streams SET restream_status = 'error', restream_error = $1 WHERE id = $2`,
            [err.message, streamId]
        );
        processes.delete(streamId);
    });

    return { pid: ffmpeg.pid, streamKey, sourceUrl };
}

/**
 * Stop a running restream
 */
async function stopRestream(streamId) {
    const entry = processes.get(streamId);
    if (!entry || !entry.process) {
        processes.delete(streamId);
        await db.query(
            `UPDATE streams SET restream_status = 'stopped' WHERE id = $1`,
            [streamId]
        );
        return;
    }

    entry.intentionallyStopped = true;

    // Send SIGTERM first
    entry.process.kill('SIGTERM');

    // Force kill after 5 seconds if still alive
    const killTimeout = setTimeout(() => {
        if (entry.process && !entry.process.killed) {
            entry.process.kill('SIGKILL');
        }
    }, 5000);

    entry.process.on('close', () => {
        clearTimeout(killTimeout);
    });

    await db.query(
        `UPDATE streams SET restream_status = 'stopped', restream_error = NULL WHERE id = $1`,
        [streamId]
    );

    processes.delete(streamId);
    logger.info(`Restream stopped for stream ${streamId}`);
}

/**
 * Get status of a restream process
 */
function getStatus(streamId) {
    const entry = processes.get(streamId);
    if (!entry) return null;

    return {
        running: entry.process && !entry.process.killed,
        pid: entry.process?.pid,
        sourceUrl: entry.sourceUrl,
        streamKey: entry.streamKey,
        startedAt: entry.startedAt,
        retries: entry.retries,
        lastError: entry.lastError
    };
}

/**
 * Recover restreams after API restart
 */
async function recoverRestreams() {
    try {
        const result = await db.query(
            `SELECT id, stream_key, restream_source_url FROM streams
             WHERE restream_status = 'pulling' AND restream_source_url IS NOT NULL AND is_active = true`
        );

        if (result.rows.length === 0) return;

        logger.info(`Recovering ${result.rows.length} restream(s)...`);

        for (const stream of result.rows) {
            try {
                await startRestream(stream.id, stream.stream_key, stream.restream_source_url);
                logger.info(`Recovered restream: ${stream.stream_key}`);
            } catch (err) {
                logger.error(`Failed to recover restream ${stream.stream_key}:`, err.message);
                await db.query(
                    `UPDATE streams SET restream_status = 'error', restream_error = $1 WHERE id = $2`,
                    [`Recovery failed: ${err.message}`, stream.id]
                );
            }
        }
    } catch (err) {
        logger.error('Error recovering restreams:', err.message);
    }
}

/**
 * Clean up all running processes (for graceful shutdown)
 */
async function cleanup() {
    const entries = Array.from(processes.entries());
    if (entries.length === 0) return;

    logger.info(`Stopping ${entries.length} restream process(es)...`);

    await Promise.all(entries.map(([streamId]) => stopRestream(streamId)));
}

module.exports = {
    startRestream,
    stopRestream,
    getStatus,
    recoverRestreams,
    cleanup
};
