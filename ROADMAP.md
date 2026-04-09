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

## Short-Term (v2.1)

- [ ] Persistent scan history (SQLite or JSON file storage)
- [ ] Dashboard authentication (basic auth or API key)
- [ ] Configurable scanner selection (enable/disable per scanner)
- [ ] Scan result diffing (highlight what changed since last scan)
- [ ] Export scan results as JSON/CSV

## Medium-Term (v2.2)

- [ ] Webhook-triggered scans (GitHub webhooks for real-time alerts)
- [ ] Multi-user support (per-user GitHub tokens and email preferences)
- [ ] Slack/Discord notification channels
- [ ] Custom scan rules and severity thresholds
- [ ] Dashboard dark/light theme toggle
- [ ] Rate limit budget display and management

## Long-Term (v3.0)

- [ ] Plugin architecture for custom scanners
- [ ] Organization-level scanning with team views
- [ ] Trend analytics and historical charts
- [ ] AI-powered fix suggestions with one-click PRs
- [ ] Mobile-responsive PWA with push notifications
- [ ] Multi-provider AI support (OpenAI, Gemini, local models)
