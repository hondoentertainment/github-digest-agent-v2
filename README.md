# 📊 GitHub Digest Agent

AI-powered daily digest that scans all your GitHub repos, emails a prioritized summary, and serves a real-time web dashboard.

## What It Scans

| Scanner | What it finds |
|---------|--------------|
| 🔴 **Builds** | Failed CI/Actions workflows in the last 24h |
| 🔀 **PRs** | Open pull requests with age, reviewers, and merge status |
| 🛡️ **Security** | Dependabot, code scanning, and secret scanning alerts |
| 🔑 **Tokens** | Expiring PATs, expired deploy keys, failing webhooks |
| 🐛 **Issues** | Open issues & bugs, prioritized by labels and age |
| 🌿 **Branches** | Stale branches older than 30 days (configurable) |

## How It Works

1. Fetches all your repos via GitHub API
2. Runs 6 scanners in parallel
3. Sends results to Claude for a prioritized, actionable summary
4. Delivers via **email digest** and/or **web dashboard**

## Quick Start

```bash
# Clone & install
git clone <your-repo-url>
cd github-digest-agent
npm install

# Configure
cp .env.example .env
# Edit .env with your tokens and email settings

# Option 1: Dashboard only (browse to http://localhost:3000)
npm run dashboard

# Option 2: Dashboard + cron scheduler + immediate scan
npm run dev

# Option 3: One-shot email digest (no dashboard)
npm run scan
```

## Architecture

```
src/
├── index.js                 # Core scan orchestrator (runScan + runDigest)
├── server.js                # Express API + dashboard server
├── scheduler.js             # Cron scheduler + server (production entry)
├── scanners/
│   ├── builds.js            # CI/Actions failure scanner
│   ├── pullRequests.js      # Open PR scanner
│   ├── security.js          # Dependabot + code + secret scanning
│   ├── tokens.js            # PAT expiration + deploy keys + webhooks
│   ├── issues.js            # Open issues & bugs
│   └── branches.js          # Stale branch scanner
├── services/
│   ├── summarizer.js        # Claude email digest generator
│   ├── dashboardSummary.js  # Claude dashboard summary generator
│   └── mailer.js            # Nodemailer email sender
└── utils/
    └── github.js            # Octokit client + repo fetcher

public/
└── index.html               # React SPA dashboard (single file)
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | Health check, last scan time, scan state |
| `GET` | `/api/scan` | Return latest scan results |
| `POST` | `/api/scan` | Trigger a new scan |
| `GET` | `/api/summary` | Claude-generated AI summary |
| `POST` | `/api/digest` | Full pipeline: scan → Claude → email |

## GitHub Token Scopes

Create a [fine-grained PAT](https://github.com/settings/tokens?type=beta) or classic token with:
- `repo` (full access)
- `read:org`
- `security_events`

## Gmail Setup

1. Enable [2-Step Verification](https://myaccount.google.com/signinoptions/two-step-verification)
2. Create an [App Password](https://myaccount.google.com/apppasswords)
3. Use the app password as `SMTP_PASS`

## Deployment

### Local (dashboard + cron)
```bash
npm start
# Dashboard at http://localhost:3000
# Email digest fires daily at 7 AM (configurable)
```

### Docker
```dockerfile
FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### GitHub Actions (email-only, free, no server)
```yaml
# .github/workflows/digest.yml
name: Daily Digest
on:
  schedule:
    - cron: '0 14 * * *'  # 7 AM PT
  workflow_dispatch:

jobs:
  digest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - run: npm run scan
        env:
          GITHUB_TOKEN: ${{ secrets.DIGEST_GITHUB_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          SMTP_HOST: smtp.gmail.com
          SMTP_PORT: 587
          SMTP_USER: ${{ secrets.SMTP_USER }}
          SMTP_PASS: ${{ secrets.SMTP_PASS }}
          EMAIL_TO: ${{ secrets.EMAIL_TO }}
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `GITHUB_TOKEN` | GitHub PAT | required |
| `GITHUB_USERNAME` | Your GitHub username | required |
| `ANTHROPIC_API_KEY` | Claude API key | required |
| `SMTP_HOST` | SMTP server | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP port | `587` |
| `SMTP_USER` | SMTP username | required |
| `SMTP_PASS` | SMTP password/app password | required |
| `EMAIL_TO` | Recipient email | required |
| `PORT` | Dashboard server port | `3000` |
| `CRON_SCHEDULE` | Cron expression | `0 7 * * *` |
| `EXCLUDE_REPOS` | Comma-separated repos to skip | — |
| `STALE_BRANCH_DAYS` | Days before branch is "stale" | `30` |

## Scripts

| Command | What it does |
|---------|-------------|
| `npm start` | Dashboard + cron scheduler (production) |
| `npm run dev` | Dashboard + cron + immediate scan |
| `npm run dashboard` | Dashboard server only (no cron) |
| `npm run scan` | One-shot scan + email (no dashboard) |
