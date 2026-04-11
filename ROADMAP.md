# GitHub Digest Agent — Roadmap

## Current State (v2.0)

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

## Future (v3.1+)

- [ ] Real-time WebSocket updates for live scan progress
- [ ] Team dashboards with role-based views
- [ ] Scheduled reports with configurable frequency per user
- [ ] Integration marketplace (Jira, Linear, PagerDuty)
- [ ] Auto-fix PR creation with AI-generated code changes
- [ ] Anomaly detection (alert on unusual spikes)
- [ ] Multi-repo comparison views
- [ ] Audit log for all dashboard actions
