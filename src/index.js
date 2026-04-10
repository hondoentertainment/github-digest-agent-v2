import dotenv from "dotenv";
dotenv.config();

import { getAllRepos } from "./utils/github.js";
import { scanFailedBuilds } from "./scanners/builds.js";
import { scanOpenPRs } from "./scanners/pullRequests.js";
import { scanSecurityAlerts } from "./scanners/security.js";
import { scanExpiredTokens } from "./scanners/tokens.js";
import { scanOpenIssues } from "./scanners/issues.js";
import { scanStaleBranches } from "./scanners/branches.js";
import { generateDigest } from "./services/summarizer.js";
import { sendDigestEmail } from "./services/mailer.js";
import { isScannerEnabled } from "./utils/scannerConfig.js";

const SCANNER_REGISTRY = [
  { key: "builds", fn: scanFailedBuilds, category: "Failed CI/Build Issues", emoji: "🔴" },
  { key: "prs", fn: scanOpenPRs, category: "Open PRs Needing Review", emoji: "🔀" },
  { key: "security", fn: scanSecurityAlerts, category: "Security Alerts & Dependabot", emoji: "🛡️" },
  { key: "tokens", fn: scanExpiredTokens, category: "Expired Tokens & Credentials", emoji: "🔑" },
  { key: "issues", fn: scanOpenIssues, category: "Open Issues & Bugs", emoji: "🐛" },
  { key: "branches", fn: scanStaleBranches, category: "Stale Branches", emoji: "🌿" },
];

/**
 * Run enabled scanners and return structured results.
 */
export async function runScan() {
  const startTime = Date.now();
  console.log("🚀 Starting GitHub scan...\n");

  console.log("📦 Fetching repositories...");
  const repos = await getAllRepos();
  console.log(`   Found ${repos.length} active repos\n`);

  console.log("🔍 Running scanners...");
  const results = await Promise.all(
    SCANNER_REGISTRY.map(({ key, fn, category, emoji }) => {
      if (!isScannerEnabled(key)) {
        console.log(`   ⏭️ ${category}: disabled`);
        return Promise.resolve({
          category, emoji, count: 0, items: [],
          summary: `${emoji} ${category} — scanner disabled`,
        });
      }
      return fn(repos).then((r) => {
        console.log(`   ✓ ${r.category}: ${r.count} items`);
        return r;
      });
    })
  );

  const [builds, prs, security, tokens, issues, branches] = results;
  const scanResults = { builds, prs, security, tokens, issues, branches };
  const totalItems = Object.values(scanResults).reduce((sum, r) => sum + r.count, 0);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n📊 Total items: ${totalItems} (${elapsed}s)`);

  return {
    meta: {
      lastRun: new Date().toISOString(),
      reposScanned: repos.length,
      totalItems,
      elapsed: `${elapsed}s`,
    },
    ...scanResults,
  };
}

/**
 * Full digest pipeline: scan → Claude summary → email.
 */
export async function runDigest() {
  const result = await runScan();
  const scanArray = [result.builds, result.prs, result.security, result.tokens, result.issues, result.branches];

  console.log("\n🤖 Generating digest with Claude...");
  const emailHtml = await generateDigest(scanArray, result.meta.reposScanned);

  console.log("📧 Sending email...");
  await sendDigestEmail(emailHtml);

  console.log("\n✅ Digest sent!");
  return result;
}

const isDirectRun = process.argv[1]?.endsWith("index.js");
if (isDirectRun) {
  runDigest().catch((err) => {
    console.error("❌ Digest failed:", err);
    process.exit(1);
  });
}
