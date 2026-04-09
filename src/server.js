import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

import { runScan, runDigest } from "./index.js";
import { generateDashboardSummary } from "./services/dashboardSummary.js";
import { octokit } from "./utils/github.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// --- State ---
let latestScan = null;
let latestSummary = null;
let scanInProgress = false;
let lastScanError = null;

// --- Middleware ---
app.use(express.json());

// --- API Routes ---

// GET /api/scan — return latest scan results
app.get("/api/scan", (req, res) => {
  if (!latestScan) {
    return res.json({ status: "no_data", message: "No scan has been run yet. POST /api/scan to trigger one." });
  }
  res.json({ status: "ok", data: latestScan });
});

// POST /api/scan — trigger a new scan
app.post("/api/scan", async (req, res) => {
  if (scanInProgress) {
    return res.status(409).json({ status: "busy", message: "A scan is already in progress." });
  }

  scanInProgress = true;
  lastScanError = null;

  try {
    latestScan = await runScan();

    // Generate AI summary in the background
    generateDashboardSummary(latestScan)
      .then((summary) => { latestSummary = summary; })
      .catch((err) => { console.error("AI summary failed:", err.message); });

    res.json({ status: "ok", data: latestScan });
  } catch (err) {
    lastScanError = err.message;
    console.error("❌ Scan failed:", err);
    res.status(500).json({ status: "error", message: err.message });
  } finally {
    scanInProgress = false;
  }
});

// GET /api/summary — return AI-generated summary
app.get("/api/summary", async (req, res) => {
  if (!latestScan) {
    return res.json({ status: "no_data", message: "Run a scan first." });
  }

  // If summary already cached, return it
  if (latestSummary) {
    return res.json({ status: "ok", data: latestSummary });
  }

  // Generate on demand
  try {
    latestSummary = await generateDashboardSummary(latestScan);
    res.json({ status: "ok", data: latestSummary });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// POST /api/digest — full pipeline: scan + email
app.post("/api/digest", async (req, res) => {
  if (scanInProgress) {
    return res.status(409).json({ status: "busy", message: "A scan is already in progress." });
  }

  scanInProgress = true;
  try {
    latestScan = await runDigest();
    res.json({ status: "ok", message: "Digest sent!", data: latestScan });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  } finally {
    scanInProgress = false;
  }
});

// GET /api/status — health check
app.get("/api/status", (req, res) => {
  res.json({
    status: "ok",
    scanInProgress,
    lastScan: latestScan?.meta?.lastRun || null,
    lastError: lastScanError,
    hasSummary: !!latestSummary,
  });
});

// DELETE /api/branches/:owner/:repo/:branch — delete a stale branch
app.delete("/api/branches/:owner/:repo/:branch", async (req, res) => {
  const { owner, repo, branch } = req.params;
  try {
    await octokit.rest.git.deleteRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });

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
    console.log(`📡 API available at http://localhost:${PORT}/api/scan`);
    console.log(`\nEndpoints:`);
    console.log(`  GET  /api/status        — health check`);
    console.log(`  GET  /api/scan          — latest scan results`);
    console.log(`  POST /api/scan          — trigger new scan`);
    console.log(`  GET  /api/summary       — AI-generated summary`);
    console.log(`  POST /api/digest        — scan + email digest`);
    console.log(`  DELETE /api/branches/…  — delete a stale branch\n`);
  });
}

export default app;
