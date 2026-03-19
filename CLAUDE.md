# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenStream is a self-hosted streaming server (RTMP ingest → HLS/DASH delivery) with a Node.js API, PostgreSQL + Redis backends, SRS media server, and NGINX reverse proxy. Designed to replace proprietary solutions like Nimble Streamer.

## Architecture

Five Docker services orchestrated via `docker-compose.yml`:
- **SRS** (port 1935) — RTMP ingest, HLS/DASH transcoding, DVR recording, writes to `/media/live` and `/media/vod`
- **NGINX** (port 80/443) — reverse proxy, media delivery with token validation, domain whitelist enforcement, serves dashboard SPA
- **API** (port 3000) — Express.js REST server, the main codebase under `api/`
- **PostgreSQL** (port 5432) — primary data store (UUID PKs, JSONB), schema in `database/init.sql`
- **Redis** (port 6379) — sessions, rate limiting, caching

Data flow: Encoder → RTMP(SRS) → HLS segments → NGINX(token-validated) → Viewer. API manages streams, auth, webhooks from SRS, and audit logging.

## Common Commands

All commands run from the `api/` directory:

```bash
npm run dev              # Start dev server (nodemon)
npm start                # Production start
npm test                 # Run all tests (jest --runInBand)
npm run test:unit        # Unit tests only (tests/unit/)
npm run test:integration # Integration tests only (tests/integration/)
npm run test:watch       # Jest watch mode
npm run test:coverage    # Coverage report
npm run lint             # ESLint
npm run migrate          # Run database migrations
```

Run a single test file: `npx jest tests/unit/someFile.test.js`

Full stack via Docker: `docker-compose up -d` from repo root.

## Code Style

ESLint enforces: 4-space indent, single quotes, semicolons required, unix linebreaks. Unused vars prefixed with `_` are allowed.

## API Source Layout (`api/src/`)

- `index.js` — Express app bootstrap, middleware setup, DB/Redis connection, server start
- `config/index.js` — Centralized config from env vars; validates production secrets (JWT_SECRET, TOKEN_SECRET must be 32+ chars)
- `routes/` — Express routers: `auth`, `streams`, `vod`, `stats`, `hooks` (SRS webhooks), `domains`, `embed`, `audit`, `internal`, `settings`
- `services/` — Business logic: `database.js` (pg pool), `redis.js`, `tokenService.js` (HMAC-SHA256), `domainService.js`, `auditLogger.js`, `logger.js` (Winston), `sentry.js`
- `middleware/` — `auth.js` (JWT verify), `validation.js` (express-validator rules), `webhookAuth.js` (webhook signature + IP whitelist)

## Security Model

Two-layer stream protection:
1. **Playback tokens** — HMAC-SHA256 signed, time-limited tokens validated by both API and NGINX
2. **Domain whitelist** — per-stream and global referer validation

API security: JWT auth (24h access / 7d refresh), bcrypt, helmet, CORS whitelist, rate limiting (auth: 5/15min, API: 10/15min, global: 1000/15min).

## Testing

Jest with `tests/setup.js` for environment setup. Tests live in `tests/unit/` and `tests/integration/`. CI runs lint, tests, `npm audit`, and TruffleHog secret scanning via GitHub Actions (`.github/workflows/ci.yml`).

## Key Environment Variables

`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `TOKEN_SECRET`, `ALLOWED_ORIGINS` (comma-separated), `SRS_WEBHOOK_IP_WHITELIST`, `NODE_ENV`. See `.env.production.example` for full list.
