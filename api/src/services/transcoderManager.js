/**
 * Transcoder Manager
 * Manages FFmpeg processes for ABR (Adaptive Bitrate) transcoding.
 * Pulls RTMP from SRS, transcodes to multiple qualities, pushes back to SRS.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('./database');
const logger = require('./logger');
const config = require('../config');

// Active sessions: Map<streamId, { processes, streamKey, masterPlaylistPath }>
// processes: Map<profileName, { process, profile, retries, startedAt, intentionallyStopped, lastError }>
const sessions = new Map();

/**
 * Build FFmpeg arguments for a transcoding profile
 */
function buildFfmpegArgs(streamKey, profile) {
    const inputUrl = `${config.transcoding.srsRtmpUrl}/live/${streamKey}`;
    const outputUrl = `${config.transcoding.srsRtmpUrl}/live/${streamKey}_${profile.name}`;

    return [
        '-hide_banner',
        '-loglevel', 'warning',
        '-i', inputUrl,
        '-c:v', profile.video_codec || 'libx264',
        '-b:v', `${profile.video_bitrate}k`,
        '-maxrate', `${profile.video_bitrate}k`,
        '-bufsize', `${profile.video_bitrate * 2}k`,
        '-vf', `scale=${profile.width}:${profile.height}`,
        '-r', String(profile.fps),
        '-profile:v', profile.video_profile || 'main',
        '-preset', profile.preset || 'medium',
        '-c:a', 'aac',
        '-b:a', `${profile.audio_bitrate}k`,
        '-ar', '44100',
        '-ac', '2',
        '-g', String(profile.fps * 2),
        '-keyint_min', String(profile.fps * 2),
        '-sc_threshold', '0',
        '-f', 'flv',
        outputUrl
    ];
}

/**
 * Write master HLS playlist referencing all variants + original
 */
function writeMasterPlaylist(streamKey, profiles) {
    let playlist = '#EXTM3U\n';

    // Add original stream as highest quality
    playlist += `#EXT-X-STREAM-INF:BANDWIDTH=8000000,NAME="Source"\n`;
    playlist += `${streamKey}.m3u8\n`;

    // Add each transcoded profile (sorted by bitrate descending)
    const sorted = [...profiles].sort((a, b) => b.video_bitrate - a.video_bitrate);
    for (const profile of sorted) {
        const bandwidth = (profile.video_bitrate + profile.audio_bitrate) * 1000;
        playlist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${profile.width}x${profile.height},NAME="${profile.display_name}"\n`;
        playlist += `${streamKey}_${profile.name}.m3u8\n`;
    }

    const playlistPath = path.join(config.transcoding.masterPlaylistDir, `${streamKey}_master.m3u8`);

    try {
        fs.writeFileSync(playlistPath, playlist);
        logger.info(`Master playlist written: ${playlistPath}`);
        return playlistPath;
    } catch (err) {
        logger.error(`Failed to write master playlist: ${err.message}`);
        return null;
    }
}

/**
 * Delete master playlist from disk
 */
function deleteMasterPlaylist(streamKey) {
    const playlistPath = path.join(config.transcoding.masterPlaylistDir, `${streamKey}_master.m3u8`);
    try {
        if (fs.existsSync(playlistPath)) {
            fs.unlinkSync(playlistPath);
            logger.info(`Master playlist deleted: ${playlistPath}`);
        }
    } catch (err) {
        logger.error(`Failed to delete master playlist: ${err.message}`);
    }
}

/**
 * Spawn a single FFmpeg transcoding process for one profile
 */
function spawnProfileProcess(streamId, streamKey, profile, session) {
    const args = buildFfmpegArgs(streamKey, profile);
    const ffmpeg = spawn('ffmpeg', args, {
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const entry = {
        process: ffmpeg,
        profile,
        retries: 0,
        startedAt: new Date(),
        intentionallyStopped: false,
        lastError: null
    };

    session.processes.set(profile.name, entry);

    let stderrBuffer = '';

    ffmpeg.stderr.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
            stderrBuffer = line;
            logger.debug(`FFmpeg transcode [${streamKey}_${profile.name}]: ${line}`);
        }
    });

    ffmpeg.stdout.on('data', (data) => {
        logger.debug(`FFmpeg transcode stdout [${streamKey}_${profile.name}]: ${data.toString().trim()}`);
    });

    ffmpeg.on('close', async (code) => {
        const currentEntry = session.processes.get(profile.name);
        if (!currentEntry || currentEntry.intentionallyStopped) {
            return;
        }

        if (code !== 0) {
            logger.warn(`FFmpeg transcode exited with code ${code} for ${streamKey}_${profile.name}`);
            currentEntry.lastError = stderrBuffer;

            if (currentEntry.retries < config.transcoding.retryAttempts) {
                const delay = config.transcoding.retryDelays[currentEntry.retries] || 60000;
                currentEntry.retries++;
                logger.info(`Retrying transcode ${streamKey}_${profile.name} in ${delay / 1000}s (attempt ${currentEntry.retries}/${config.transcoding.retryAttempts})`);

                setTimeout(() => {
                    const sess = sessions.get(streamId);
                    if (sess && !currentEntry.intentionallyStopped) {
                        const retryCount = currentEntry.retries;
                        spawnProfileProcess(streamId, streamKey, profile, sess);
                        const newEntry = sess.processes.get(profile.name);
                        if (newEntry) {
                            newEntry.retries = retryCount;
                        }
                    }
                }, delay);
            } else {
                logger.error(`Transcode ${streamKey}_${profile.name} failed after ${config.transcoding.retryAttempts} retries`);
                currentEntry.lastError = stderrBuffer || `FFmpeg exited with code ${code}`;

                // Check if ALL profiles have failed
                const allFailed = Array.from(session.processes.values()).every(
                    e => e.lastError && e.retries >= config.transcoding.retryAttempts
                );
                if (allFailed) {
                    await db.query(
                        `UPDATE streams SET transcoding_status = 'error', transcoding_error = $1 WHERE id = $2`,
                        [`All profiles failed. Last error: ${stderrBuffer}`, streamId]
                    );
                }
            }
        }
    });

    ffmpeg.on('error', (err) => {
        logger.error(`FFmpeg spawn error for ${streamKey}_${profile.name}:`, err.message);
        const currentEntry = session.processes.get(profile.name);
        if (currentEntry) {
            currentEntry.lastError = err.message;
        }
    });

    return ffmpeg;
}

/**
 * Start transcoding a stream to multiple quality profiles
 */
async function startTranscoding(streamId, streamKey, profileNames) {
    // Check if already running
    if (sessions.has(streamId)) {
        const existing = sessions.get(streamId);
        const hasRunning = Array.from(existing.processes.values()).some(
            e => e.process && !e.process.killed
        );
        if (hasRunning) {
            throw new Error('Transcoding already running for this stream');
        }
    }

    // Check concurrency limit
    if (sessions.size >= config.transcoding.maxConcurrent) {
        throw new Error(`Transcoding limit reached (${config.transcoding.maxConcurrent} concurrent max)`);
    }

    // Load profiles from database
    let profiles;
    if (profileNames && profileNames.length > 0) {
        const result = await db.query(
            `SELECT * FROM transcoding_profiles WHERE name = ANY($1) AND is_active = true ORDER BY sort_order`,
            [profileNames]
        );
        profiles = result.rows;
    } else {
        // Check stream-specific profile assignments
        const assigned = await db.query(
            `SELECT tp.* FROM transcoding_profiles tp
             JOIN stream_transcoding_profiles stp ON tp.id = stp.profile_id
             WHERE stp.stream_id = $1 AND tp.is_active = true
             ORDER BY tp.sort_order`,
            [streamId]
        );

        if (assigned.rows.length > 0) {
            profiles = assigned.rows;
        } else {
            // Fall back to default profiles from config
            const result = await db.query(
                `SELECT * FROM transcoding_profiles WHERE name = ANY($1) AND is_active = true ORDER BY sort_order`,
                [config.transcoding.defaultProfiles]
            );
            profiles = result.rows;
        }
    }

    if (profiles.length === 0) {
        throw new Error('No active transcoding profiles found');
    }

    logger.info(`Starting transcoding for ${streamKey} with profiles: ${profiles.map(p => p.name).join(', ')}`);

    const session = {
        processes: new Map(),
        streamKey,
        masterPlaylistPath: null,
        startedAt: new Date()
    };

    sessions.set(streamId, session);

    // Spawn FFmpeg process for each profile
    for (const profile of profiles) {
        spawnProfileProcess(streamId, streamKey, profile, session);
    }

    // Write master playlist
    session.masterPlaylistPath = writeMasterPlaylist(streamKey, profiles);

    // Update database
    await db.query(
        `UPDATE streams SET transcoding_status = 'active', transcoding_error = NULL WHERE id = $1`,
        [streamId]
    );

    return {
        streamKey,
        profiles: profiles.map(p => p.name),
        masterPlaylist: `${streamKey}_master.m3u8`
    };
}

/**
 * Stop transcoding for a stream
 */
async function stopTranscoding(streamId) {
    const session = sessions.get(streamId);
    if (!session) {
        await db.query(
            `UPDATE streams SET transcoding_status = 'stopped', transcoding_error = NULL WHERE id = $1`,
            [streamId]
        );
        return;
    }

    // Mark all processes as intentionally stopped
    for (const [, entry] of session.processes) {
        entry.intentionallyStopped = true;

        if (entry.process && !entry.process.killed) {
            entry.process.kill('SIGTERM');

            // Force kill after timeout
            const killTimeout = setTimeout(() => {
                if (entry.process && !entry.process.killed) {
                    entry.process.kill('SIGKILL');
                }
            }, config.transcoding.gracefulStopTimeout);

            entry.process.on('close', () => {
                clearTimeout(killTimeout);
            });
        }
    }

    // Delete master playlist
    deleteMasterPlaylist(session.streamKey);

    // Update database
    await db.query(
        `UPDATE streams SET transcoding_status = 'stopped', transcoding_error = NULL WHERE id = $1`,
        [streamId]
    );

    sessions.delete(streamId);
    logger.info(`Transcoding stopped for stream ${streamId}`);
}

/**
 * Get status of transcoding for a stream
 */
function getStatus(streamId) {
    const session = sessions.get(streamId);
    if (!session) return null;

    const profiles = {};
    for (const [name, entry] of session.processes) {
        profiles[name] = {
            running: entry.process && !entry.process.killed,
            pid: entry.process?.pid,
            retries: entry.retries,
            startedAt: entry.startedAt,
            lastError: entry.lastError
        };
    }

    return {
        streamKey: session.streamKey,
        startedAt: session.startedAt,
        masterPlaylist: `${session.streamKey}_master.m3u8`,
        profiles
    };
}

/**
 * Get count of active transcoding sessions
 */
function getActiveCount() {
    return sessions.size;
}

/**
 * Get all active session statuses (for dashboard)
 */
function getAllStatuses() {
    const statuses = [];
    for (const [streamId, session] of sessions) {
        const profiles = {};
        for (const [name, entry] of session.processes) {
            profiles[name] = {
                running: entry.process && !entry.process.killed,
                pid: entry.process?.pid,
                retries: entry.retries,
                lastError: entry.lastError
            };
        }
        statuses.push({
            streamId,
            streamKey: session.streamKey,
            startedAt: session.startedAt,
            masterPlaylist: `${session.streamKey}_master.m3u8`,
            profiles
        });
    }
    return statuses;
}

/**
 * Recover transcoding sessions after API restart
 */
async function recoverTranscoding() {
    try {
        const result = await db.query(
            `SELECT id, stream_key FROM streams
             WHERE transcoding_status = 'active' AND status = 'live'
             AND is_transcoding_enabled = true AND is_active = true`
        );

        if (result.rows.length === 0) return;

        logger.info(`Recovering ${result.rows.length} transcoding session(s)...`);

        for (const stream of result.rows) {
            try {
                await startTranscoding(stream.id, stream.stream_key);
                logger.info(`Recovered transcoding: ${stream.stream_key}`);
            } catch (err) {
                logger.error(`Failed to recover transcoding ${stream.stream_key}:`, err.message);
                await db.query(
                    `UPDATE streams SET transcoding_status = 'error', transcoding_error = $1 WHERE id = $2`,
                    [`Recovery failed: ${err.message}`, stream.id]
                );
            }
        }
    } catch (err) {
        logger.error('Error recovering transcoding:', err.message);
    }
}

/**
 * Clean up all transcoding processes (for graceful shutdown)
 */
async function cleanup() {
    const entries = Array.from(sessions.keys());
    if (entries.length === 0) return;

    logger.info(`Stopping ${entries.length} transcoding session(s)...`);

    await Promise.all(entries.map(streamId => stopTranscoding(streamId)));
}

module.exports = {
    startTranscoding,
    stopTranscoding,
    getStatus,
    getActiveCount,
    getAllStatuses,
    recoverTranscoding,
    cleanup
};
