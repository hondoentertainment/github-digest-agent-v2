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
import { sendNotifications } from "./services/notifier.js";
import { isScannerEnabled } from "./utils/scannerConfig.js";
import { loadPlugins } from "./utils/pluginLoader.js";
import { computeEngineeringMetrics } from "./utils/engineeringMetrics.js";
import { broadcastScanProgress } from "./utils/scanProgressHub.js";

const SCANNER_REGISTRY = [
  { key: "builds", fn: scanFailedBuilds, category: "Failed CI/Build Issues", emoji: "🔴" },
  { key: "prs", fn: scanOpenPRs, category: "Open PRs Needing Review", emoji: "🔀" },
  { key: "security", fn: scanSecurityAlerts, category: "Security Alerts & Dependabot", emoji: "🛡️" },
  { key: "tokens", fn: scanExpiredTokens, category: "Expired Tokens & Credentials", emoji: "🔑" },
  { key: "issues", fn: scanOpenIssues, category: "Open Issues & Bugs", emoji: "🐛" },
  { key: "branches", fn: scanStaleBranches, category: "Stale Branches", emoji: "🌿" },
];

/**
 * Run enabled scanners (built-in + plugins) and return structured results.
 * @param {{ onProgress?: (p: { phase: string; ts: number; [k: string]: unknown }) => void } | undefined} [options]
 */
export async function runScan(options) {
  const onProgress =
    typeof options === "function"
      ? options
      : options && typeof options === "object" && typeof options.onProgress === "function"
        ? options.onProgress
        : null;

  const emit = (phase, detail = {}) => {
    const payload = { phase, ts: Date.now(), ...detail };
    if (onProgress) onProgress(payload);
    broadcastScanProgress(payload);
  };

  const startTime = Date.now();
  console.log("🚀 Starting GitHub scan...\n");
  emit("scan_start", {});

  console.log("📦 Fetching repositories...");
  emit("fetch_repos_start", {});
  let repos;
  try {
    repos = await getAllRepos();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    emit("scan_error", { message });
    throw err;
  }
  console.log(`   Found ${repos.length} active repos\n`);
  emit("fetch_repos_done", { repoCount: repos.length });

  let plugins = [];
  try {
    plugins = await loadPlugins();
    if (plugins.length) console.log(`🧩 Loaded ${plugins.length} plugin(s)`);
    emit("plugins_loaded", { pluginCount: plugins.length });
  } catch (err) {
    console.warn("Plugin loading failed:", err.message);
    emit("plugins_loaded", { pluginCount: 0, warning: err.message });
  }

  console.log("🔍 Running scanners...");
  emit("scanners_start", { builtin: SCANNER_REGISTRY.map((s) => s.key) });
  const results = await Promise.all(
    SCANNER_REGISTRY.map(({ key, fn, category, emoji }) => {
      if (!isScannerEnabled(key)) {
        console.log(`   ⏭️ ${category}: disabled`);
        emit("scanner_done", { key, count: 0, skipped: true });
        return Promise.resolve({
          category, emoji, count: 0, items: [],
          summary: `${emoji} ${category} — scanner disabled`,
        });
      }
      emit("scanner_start", { key });
      return fn(repos).then((r) => {
        console.log(`   ✓ ${r.category}: ${r.count} items`);
        emit("scanner_done", { key, count: r.count });
        return r;
      });
    })
  );

  emit("plugin_scanners_start", { keys: plugins.map((p) => p.key) });
  const pluginResults = await Promise.all(
    plugins.map(async (plugin) => {
      try {
        emit("plugin_scanner_start", { key: plugin.key });
        const r = await plugin.scan(repos);
        console.log(`   🧩 ${r.category}: ${r.count} items`);
        emit("plugin_scanner_done", { key: plugin.key, count: r.count });
        return { key: plugin.key, ...r };
      } catch (err) {
        console.warn(`   ⚠️ Plugin ${plugin.key} failed:`, err.message);
        emit("plugin_scanner_done", { key: plugin.key, count: 0, error: err.message });
        return {
          key: plugin.key, category: plugin.category, emoji: plugin.emoji,
          count: 0, items: [], summary: `Plugin error: ${err.message}`,
        };
      }
    })
  );

  const [builds, prs, security, tokens, issues, branches] = results;
  const scanResults = { builds, prs, security, tokens, issues, branches };

  for (const pr of pluginResults) {
    scanResults[pr.key] = pr;
  }

  const totalItems = Object.values(scanResults).reduce((sum, r) => sum + (r.count || 0), 0);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n📊 Total items: ${totalItems} (${elapsed}s)`);

  const snapshot = { ...scanResults };
  const engineeringMetrics = computeEngineeringMetrics(snapshot);

  emit("scan_complete", { totalItems, elapsed: `${elapsed}s`, reposScanned: repos.length });

  return {
    meta: {
      lastRun: new Date().toISOString(),
      reposScanned: repos.length,
      totalItems,
      elapsed: `${elapsed}s`,
      plugins: pluginResults.map((p) => p.key),
      engineeringMetrics,
    },
    ...scanResults,
  };
}

/**
 * Full digest pipeline: scan → Claude summary → email → notifications.
 */
export async function runDigest() {
  const result = await runScan();
  const scanArray = [result.builds, result.prs, result.security, result.tokens, result.issues, result.branches];

  console.log("\n🤖 Generating digest with Claude...");
  const emailHtml = await generateDigest(scanArray, result.meta.reposScanned);

  console.log("📧 Sending email...");
  await sendDigestEmail(emailHtml);

  console.log("🔔 Sending notifications...");
  await sendNotifications(result);

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
