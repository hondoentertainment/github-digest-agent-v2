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

/**
 * Run all scanners and return structured results (no email).
 * Used by both the email digest and the web dashboard API.
 */
export async function runScan() {
  const startTime = Date.now();
  console.log("🚀 Starting GitHub scan...\n");

  console.log("📦 Fetching repositories...");
  const repos = await getAllRepos();
  console.log(`   Found ${repos.length} active repos\n`);

  console.log("🔍 Running scanners...");
  const [builds, prs, security, tokens, issues, branches] = await Promise.all([
    scanFailedBuilds(repos).then((r) => { console.log(`   ✓ Builds: ${r.count} failures`); return r; }),
    scanOpenPRs(repos).then((r) => { console.log(`   ✓ PRs: ${r.count} open`); return r; }),
    scanSecurityAlerts(repos).then((r) => { console.log(`   ✓ Security: ${r.count} alerts`); return r; }),
    scanExpiredTokens(repos).then((r) => { console.log(`   ✓ Tokens: ${r.count} issues`); return r; }),
    scanOpenIssues(repos).then((r) => { console.log(`   ✓ Issues: ${r.count} open`); return r; }),
    scanStaleBranches(repos).then((r) => { console.log(`   ✓ Branches: ${r.count} stale`); return r; }),
  ]);

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

// Run if called directly (node src/index.js)
const isDirectRun = process.argv[1]?.endsWith("index.js");
if (isDirectRun) {
  runDigest().catch((err) => {
    console.error("❌ Digest failed:", err);
    process.exit(1);
  });
}
