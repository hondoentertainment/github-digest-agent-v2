# GitHub Digest Agent v2

**AI-powered GitHub digest agent** — scans repositories, summarizes findings with AI, delivers email digests, and exposes a live web dashboard.

[![CI](https://img.shields.io/badge/CI-placeholder-lightgrey)](https://github.com)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-green)](https://nodejs.org)

## Features

- **Six scanners** — failed builds/CI, open PRs, security alerts (Dependabot, code scanning, secret scanning), expiring tokens and credential hygiene, open issues and bugs, stale branches
- **AI summaries** — prioritized, natural-language digests for email and the dashboard
- **Email delivery** — SMTP-powered digest mailouts
- **Web dashboard** — single-page UI for status, scan results, history, and configuration
- **Authentication** — optional shared password / API key for API access
- **Scan history** — persisted runs with diffing against the previous scan
- **Export** — JSON and CSV downloads of the latest scan
- **Diffing** — compare consecutive scans to spot what changed
- **Notifications** — Slack and Discord webhooks when configured
- **Theme** — light/dark dashboard appearance
- **Plugins** — load custom scanners from a `plugins/` directory (see [Plugins](#plugins))
- **Webhooks** — outbound notification hooks (Slack/Discord) tied to digest events
- **Trends** — rolling signals across scans for recurring issues
- **Multi-AI** — provider abstraction supports multiple model backends (see `src/services/aiProvider.js`)
- **Org scanning** — discovers repos across organizations the token can access
- **Multi-user utilities** — user store helpers for future or local multi-tenant setups (`src/utils/users.js`)
- **PWA** — `manifest.json` and service worker assets for installable/offline-friendly dashboard behavior
- **AI fix suggestions** — contextual remediation hints in summaries where the model infers fixes

## Quick Start

### Prerequisites

- **Node.js 22+**
- **GitHub Personal Access Token** with `repo`, `read:org`, and `security_events` (and organization access as needed)

### Steps

```bash
git clone <your-repo-url>
cd github-digest-agent-v2
npm install
cp .env.example .env
```

Edit `.env` with your `GITHUB_TOKEN`, AI keys, SMTP settings, and optional dashboard password. Then:

```bash
npm run dev
```

This starts the scheduler (with an immediate digest when using `--now`), imports the dashboard server, and serves the UI (default [http://localhost:3000](http://localhost:3000)).

| Command | Purpose |
|--------|---------|
| `npm start` | Production-style run: cron + dashboard |
| `npm run dev` | Same as start plus immediate digest (`--now`) |
| `npm run server` / `npm run dashboard` | Dashboard/API only (no cron) |
| `npm run scan` | One-shot scan + email (no long-running server) |

## Configuration

Environment variables (from `.env.example`):

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub PAT with `repo`, `read:org`, `security_events` |
| `ANTHROPIC_API_KEY` | API key for Claude (default AI backend) |
| `AI_MODEL` | Model id (default in example: `claude-sonnet-4-20250514`) |
| `SMTP_HOST` | Outbound SMTP hostname (e.g. Gmail) |
| `SMTP_PORT` | SMTP port (often `587` for STARTTLS) |
| `SMTP_USER` | SMTP username |
| `SMTP_PASS` | SMTP password or app password |
| `EMAIL_TO` | Digest recipient address |
| `EMAIL_FROM` | From header (name + address) |
| `PORT` | HTTP port for the dashboard/API |
| `CRON_SCHEDULE` | Cron expression for scheduled digests (default `0 7 * * *`) |
| `EXCLUDE_REPOS` | Comma-separated `owner/repo` entries to skip |
| `DASHBOARD_PASSWORD` | If set, protects most `/api/*` routes (Bearer token or `X-Api-Key`) |
| `ENABLED_SCANNERS` | Comma-separated subset: `builds`, `prs`, `security`, `tokens`, `issues`, `branches` |
| `STALE_BRANCH_DAYS` | Age threshold for stale-branch scanner |
| `BUILD_WINDOW_HOURS` | Lookback window for failed workflows |
| `SEVERITY_THRESHOLD` | Minimum alert severity to surface (e.g. `low`) |
| `MAX_ITEMS_PER_SCANNER` | Cap items per scanner category |
| `MAX_SCAN_HISTORY` | Number of historical scans to retain |
| `SLACK_WEBHOOK_URL` | Optional Slack incoming webhook |
| `DISCORD_WEBHOOK_URL` | Optional Discord webhook |

## Architecture

High-level data flow (scheduler, server, scanners, services, utils):

```
                    +------------------+
                    |  scheduler.js    |
                    |  (node-cron)     |
                    +--------+---------+
                             |
              runDigest()    |  imports
              +--------------+------------------+
              v                                  v
       +-------------+                   +-------------+
       |  index.js   |                   |  server.js  |
       | orchestrator|                   |  Express    |
       +------+------+                   +------+------+
              |                                 |
    runScan() | parallel                        | REST + static
              v                                 v
       +-------------+                   +-------------+
       | scanners/*  |                   | middleware  |
       | builds, prs |                   | auth, limit |
       | security... |                   +------+------+
       +------+------+                          |
              |                                 |
              +-------------+-------------------+
                            v
                     +-------------+
                     | services/*  |
                     | summarizer  |
                     | mailer      |
                     | notifier    |
                     | dashboard   |
                     | AI provider |
                     +------+------+
                            |
                            v
                     +-------------+
                     |  utils/*    |
                     | github      |
                     | storage     |
                     | diff, rules |
                     | scan lock   |
                     +-------------+
```

## API Reference

Unless `DASHBOARD_PASSWORD` is unset, protected routes require `Authorization: Bearer <password>` or `X-Api-Key: <password>`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/auth` | No | Returns whether dashboard auth is enabled |
| `POST` | `/api/login` | No | Password check (rate-limited); returns ok when auth disabled |
| `GET` | `/api/status` | No | Health, scan lock state, last run, history count |
| `GET` | `/api/scan` | If password set | Latest scan payload and diff vs previous |
| `POST` | `/api/scan` | If password set | Run a new scan; updates storage and diff |
| `GET` | `/api/summary` | If password set | AI-generated dashboard summary (cached after first generation) |
| `POST` | `/api/digest` | If password set | Full pipeline: scan → summary → email/notifications |
| `GET` | `/api/history` | If password set | List stored scan history metadata |
| `GET` | `/api/history/:id` | If password set | Single historical scan by id |
| `GET` | `/api/config/scanners` | If password set | All scanner names and enabled set |
| `POST` | `/api/config/scanners` | If password set | Update enabled scanners (`{ "scanners": [...] }`) |
| `GET` | `/api/config/rules` | If password set | Current scan rule thresholds |
| `POST` | `/api/config/rules` | If password set | Update rules (`{ "rules": { ... } }`) |
| `GET` | `/api/rate-limit` | If password set | GitHub API rate-limit snapshot |
| `GET` | `/api/config/notifications` | If password set | Configured notification channels |
| `GET` | `/api/export/json` | If password set | Download latest scan as JSON |
| `GET` | `/api/export/csv` | If password set | Download latest scan as CSV |
| `DELETE` | `/api/branches/:owner/:repo/:branch` | If password set | Delete a remote branch ref via GitHub API |

Non-API routes serve static assets from `public/` and fall back to `index.html` for the SPA.

## Dashboard

![Dashboard screenshot placeholder](docs/images/dashboard-placeholder.png)

- Real-time scan status, category breakdowns, and AI narrative summary  
- History navigation, export actions, and branch cleanup where supported  
- Light/dark theme and responsive layout  
- PWA installability when served over HTTPS with valid manifest/sw  

_Add your screenshots under `docs/images/` and update the image path above._

## Plugins

Custom scanner plugins extend the digest without editing core scanner files.

1. Create `plugins/<name>.js` at the project root (sibling to `src/`).
2. Export a **default async function** with the same general contract as built-in scanners: accept the repo list (or compatible context) and return `{ category, emoji, count, items, summary }` (fields aligned with `src/index.js` expectations).
3. Register or enable the plugin according to your deployment notes (hook into `SCANNER_REGISTRY` or a dynamic loader when you wire plugins in your fork).

Keep plugins side-effect free at import time; perform network work only inside the exported function.

## Docker

Build and run with your environment file:

```bash
docker build -t github-digest-agent-v2 .
docker run --rm -p 3000:3000 --env-file .env github-digest-agent-v2
```

The image uses `npm start` (scheduler + dashboard) and exposes port `3000`. A `HEALTHCHECK` hits `GET /api/status`.

## Testing

```bash
npm test
```

Tests use **Vitest** and **supertest** where HTTP behavior is covered.

| File | Focus |
|------|--------|
| `tests/api.test.js` | HTTP API surface |
| `tests/auth.test.js` | Authentication middleware |
| `tests/diff.test.js` | Scan diff utilities |
| `tests/retry.test.js` | Retry helpers |
| `tests/scanLock.test.js` | Concurrent scan locking |
| `tests/scanners.test.js` | Scanner behavior |
| `tests/services.test.js` | Services (mail, AI, etc.) |

## Contributing

1. Fork the repository and create a focused branch for your change.  
2. Follow existing code style (ES modules, minimal dependencies for small utilities).  
3. Add or update tests for behavior you change.  
4. Run `npm test` before opening a pull request.  
5. Describe the problem and solution clearly in the PR; link related issues when applicable.  

## License

MIT
