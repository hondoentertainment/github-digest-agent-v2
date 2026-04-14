# GitHub Digest Agent — Roadmap

## Current State (v3.2)

- 6 parallel scanners: builds, PRs, security, tokens, issues, stale branches
- Claude-powered email digests and dashboard summaries
- Express REST API + React SPA dashboard
- Cron scheduling with optional immediate execution
- Email delivery via SMTP/Nodemailer
- Branch deletion from dashboard
- Retry/backoff for API resilience
- CI/CD via GitHub Actions
- Docker support

## Short-Term (v2.1) — Shipped

- [x] Persistent scan history (JSON file storage)
- [x] Dashboard authentication (password / API key)
- [x] Configurable scanner selection (enable/disable per scanner)
- [x] Scan result diffing (highlight what changed since last scan)
- [x] Export scan results as JSON/CSV

## Medium-Term (v2.2) — Shipped

- [x] Slack/Discord notification channels (webhook-based)
- [x] Custom scan rules and severity thresholds
- [x] Dashboard dark/light theme toggle
- [x] Rate limit budget display and management

## v3.0 — Shipped

- [x] Plugin architecture for custom scanners
- [x] Organization-level scanning with org filter
- [x] Trend analytics and historical SVG charts
- [x] AI-powered fix suggestions with confidence levels
- [x] Mobile-responsive PWA with service worker
- [x] Multi-provider AI support (Claude, OpenAI, Gemini)
- [x] Webhook-triggered scans (GitHub webhooks with signature verification)
- [x] Multi-user support (per-user accounts and preferences)
- [x] Production hardening (security headers, structured request logging)
- [x] Bug fixes (duplicate notifications, scheduler cleanup)

## v3.1 — Shipped (hardening & ops)

- [x] Webhook HMAC verification, bcrypt passwords, JWT sessions, CSP security headers
- [x] Atomic config/scan writes; branch delete updates latest scan without bogus history rows
- [x] Vitest suite, CI with audit + coverage thresholds
- [x] Prometheus-style `/metrics`, `/healthz`, `/readyz`, audit log API
- [x] Shared concurrent GitHub fetches, trend response cache, clamped trend windows
- [x] Zod validation on mutating APIs + per-IP write rate limits
- [x] Multi-user login with admin/viewer RBAC
- [x] DORA-lite engineering metrics API + dashboard Metrics tab
- [x] Dashboard a11y (tabs, dialogs, live region) and consistent JSON error handling from fetch
- [x] Alert rules (thresholds + PagerDuty hook), Linear/Jira ticket API, per-user digest schedule

## v3.2 — Shipped

- [x] Real-time WebSocket `/ws/scan` with live phase updates during scans (token query when auth is on)
- [x] Team / scoped dashboards: `preferences.visibleOrgs` per user (viewer) filters scan, summary, metrics, exports, org list, compare, anomalies
- [x] Auto-fix PR from fix modal when AI sets `canAutoPR` + `suggestedBranch` (`POST /api/create-pr`)
- [x] Anomaly detection: rolling total-items spike rule in alert config + PagerDuty path; `GET /api/anomalies` for dashboard
- [x] Multi-repo comparison: `POST /api/compare-repos` + **Compare** tab

## v3.3 — Shipped

- [x] WebSocket auth: first JSON message `{ "type": "auth", "token": "..." }` (no token in URL); optional `Sec-WebSocket-Protocol` with comma-separated values where a non-`digest-auth` segment is the JWT or shared password
- [x] Historical trend series filtered for team views (`visibleOrgs`) with per-scope trend cache keys
- [x] Auto-fix PR with committed file patches when the AI returns `fileChanges` / client sends `files` on `POST /api/create-pr`

## Future (v3.4+)

- [ ] Further WebSocket hardening (origin checks, narrower timeouts)
