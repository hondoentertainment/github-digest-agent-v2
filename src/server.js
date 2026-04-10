import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

import { runScan, runDigest } from "./index.js";
import { generateDashboardSummary } from "./services/dashboardSummary.js";
import { octokit } from "./utils/github.js";
import { saveScan, getLatestScan, getPreviousScan, getHistory, getScan } from "./utils/storage.js";
import { authMiddleware, isAuthEnabled } from "./middleware/auth.js";
import { getEnabledScanners, setEnabledScanners, getAllScannerNames } from "./utils/scannerConfig.js";
import { diffScans } from "./utils/diff.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// --- State ---
let latestScan = getLatestScan();
let latestSummary = null;
let scanInProgress = false;
let lastScanError = null;
let latestDiff = null;

if (latestScan) {
  const prev = getPreviousScan();
  if (prev) latestDiff = diffScans(latestScan, prev);
}

// --- Middleware ---
app.use(express.json());

// --- Public Routes (no auth) ---

app.get("/api/auth", (req, res) => {
  res.json({ enabled: isAuthEnabled() });
});

app.post("/api/login", (req, res) => {
  if (!isAuthEnabled()) return res.json({ status: "ok" });
  const { password } = req.body;
  if (password === process.env.DASHBOARD_PASSWORD) {
    res.json({ status: "ok" });
  } else {
    res.status(401).json({ status: "unauthorized", message: "Invalid password." });
  }
});

// --- Auth Middleware (protects all routes defined below) ---
app.use("/api", authMiddleware);

// --- Status ---

app.get("/api/status", (req, res) => {
  res.json({
    status: "ok",
    scanInProgress,
    lastScan: latestScan?.meta?.lastRun || null,
    lastError: lastScanError,
    hasSummary: !!latestSummary,
    historyCount: getHistory().length,
  });
});

// --- Scan ---

app.get("/api/scan", (req, res) => {
  if (!latestScan) {
    return res.json({ status: "no_data", message: "No scan has been run yet. POST /api/scan to trigger one." });
  }
  res.json({ status: "ok", data: latestScan, diff: latestDiff });
});

app.post("/api/scan", async (req, res) => {
  if (scanInProgress) {
    return res.status(409).json({ status: "busy", message: "A scan is already in progress." });
  }

  scanInProgress = true;
  lastScanError = null;

  try {
    const previousScan = latestScan;
    latestScan = await runScan();
    saveScan(latestScan);
    latestDiff = previousScan ? diffScans(latestScan, previousScan) : null;

    latestSummary = null;
    generateDashboardSummary(latestScan)
      .then((summary) => { latestSummary = summary; })
      .catch((err) => { console.error("AI summary failed:", err.message); });

    res.json({ status: "ok", data: latestScan, diff: latestDiff });
  } catch (err) {
    lastScanError = err.message;
    console.error("❌ Scan failed:", err);
    res.status(500).json({ status: "error", message: err.message });
  } finally {
    scanInProgress = false;
  }
});

// --- Summary ---

app.get("/api/summary", async (req, res) => {
  if (!latestScan) {
    return res.json({ status: "no_data", message: "Run a scan first." });
  }
  if (latestSummary) {
    return res.json({ status: "ok", data: latestSummary });
  }
  try {
    latestSummary = await generateDashboardSummary(latestScan);
    res.json({ status: "ok", data: latestSummary });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// --- Digest ---

app.post("/api/digest", async (req, res) => {
  if (scanInProgress) {
    return res.status(409).json({ status: "busy", message: "A scan is already in progress." });
  }

  scanInProgress = true;
  try {
    const previousScan = latestScan;
    latestScan = await runDigest();
    saveScan(latestScan);
    latestDiff = previousScan ? diffScans(latestScan, previousScan) : null;
    res.json({ status: "ok", message: "Digest sent!", data: latestScan, diff: latestDiff });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  } finally {
    scanInProgress = false;
  }
});

// --- History ---

app.get("/api/history", (req, res) => {
  res.json({ status: "ok", data: getHistory() });
});

app.get("/api/history/:id", (req, res) => {
  const scan = getScan(req.params.id);
  if (!scan) {
    return res.status(404).json({ status: "error", message: "Scan not found." });
  }
  res.json({ status: "ok", data: scan });
});

// --- Scanner Config ---

app.get("/api/config/scanners", (req, res) => {
  res.json({
    status: "ok",
    data: { all: getAllScannerNames(), enabled: getEnabledScanners() },
  });
});

app.post("/api/config/scanners", (req, res) => {
  const { scanners } = req.body;
  if (!Array.isArray(scanners)) {
    return res.status(400).json({ status: "error", message: "scanners must be an array." });
  }
  const updated = setEnabledScanners(scanners);
  res.json({ status: "ok", data: { enabled: updated } });
});

// --- Export ---

app.get("/api/export/json", (req, res) => {
  if (!latestScan) {
    return res.status(404).json({ status: "error", message: "No scan data to export." });
  }
  res.setHeader("Content-Disposition", `attachment; filename="github-digest-${Date.now()}.json"`);
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(latestScan, null, 2));
});

app.get("/api/export/csv", (req, res) => {
  if (!latestScan) {
    return res.status(404).json({ status: "error", message: "No scan data to export." });
  }

  const rows = [["Category", "Repo", "Title", "Severity", "Age (days)", "URL"]];
  const formatters = {
    builds: (i) => [i.repo, `${i.workflow} failed on ${i.branch}`, i.conclusion || "", "", i.url],
    prs: (i) => [i.repo, `#${i.number} ${i.title}`, i.draft ? "draft" : "", String(i.ageDays), i.url],
    security: (i) => [i.repo, i.title, i.severity, "", i.url],
    tokens: (i) => [i.repo, i.title, i.severity, "", i.url],
    issues: (i) => [i.repo, `#${i.number} ${i.title}`, i.isBug ? "bug" : "", String(i.ageDays), i.url],
    branches: (i) => [i.repo, i.branch, i.protected ? "protected" : "", String(i.ageDays), i.url],
  };

  for (const [cat, formatter] of Object.entries(formatters)) {
    for (const item of latestScan[cat]?.items || []) {
      rows.push([latestScan[cat].category || cat, ...formatter(item)]);
    }
  }

  const csv = rows.map((row) => row.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Disposition", `attachment; filename="github-digest-${Date.now()}.csv"`);
  res.setHeader("Content-Type", "text/csv");
  res.send(csv);
});

// --- Branch Delete ---

app.delete("/api/branches/:owner/:repo/:branch", async (req, res) => {
  const { owner, repo, branch } = req.params;
  try {
    await octokit.rest.git.deleteRef({ owner, repo, ref: `heads/${branch}` });

    if (latestScan?.branches?.items) {
      latestScan.branches.items = latestScan.branches.items.filter(
        (b) => !(b.repo === `${owner}/${repo}` && b.branch === branch)
      );
      latestScan.branches.count = latestScan.branches.items.length;
    }

    res.json({ status: "ok", message: `Deleted branch '${branch}' from ${owner}/${repo}` });
  } catch (err) {
    console.error(`Failed to delete branch ${branch}:`, err.message);
    res.status(err.status || 500).json({ status: "error", message: err.message });
  }
});

// --- Serve Dashboard ---
app.use(express.static(path.join(__dirname, "../public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// --- Start ---
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`\n🌐 GitHub Digest Dashboard running at http://localhost:${PORT}`);
    console.log(`🔒 Authentication: ${isAuthEnabled() ? "ENABLED" : "disabled"}`);
    console.log(`🔍 Scanners: ${getEnabledScanners().join(", ")}`);
    console.log(`📁 Scan history: ${getHistory().length} entries\n`);
  });
}

export default app;
