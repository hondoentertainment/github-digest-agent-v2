import express from "express";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
dotenv.config();

import { runScan, runDigest } from "./index.js";
import { generateDashboardSummary } from "./services/dashboardSummary.js";
import { octokit, getRateLimitInfo } from "./utils/github.js";
import {
  saveScan,
  getLatestScan,
  getPreviousScan,
  getHistory,
  getScan,
  writeScanPayload,
  getLatestHistoryId,
} from "./utils/storage.js";
import { authMiddleware, isAuthEnabled, signSessionToken } from "./middleware/auth.js";
import { verifySessionToken } from "./services/jwtTokens.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { securityHeaders } from "./middleware/securityHeaders.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { requireAdmin } from "./middleware/rbac.js";
import { getEnabledScanners, setEnabledScanners, getAllScannerNames } from "./utils/scannerConfig.js";
import { diffScans } from "./utils/diff.js";
import { withScanLock, isScanLocked, getScanError } from "./utils/scanLock.js";
import { getNotificationChannels } from "./services/notifier.js";
import { getRules, setRules } from "./utils/scanRules.js";
import { clampTrendDays } from "./utils/trends.js";
import { getTrendsCached, invalidateTrendCache, getCategoryTrendCached } from "./utils/trendCache.js";
import { loadPlugins, getPluginsDir } from "./utils/pluginLoader.js";
import { getOrgList, groupByOrg, getOrgSummary, compareReposInScan } from "./utils/orgGrouper.js";
import { filterScanForRequest, getVisibleOrgsForRequest } from "./utils/viewScope.js";
import { buildAnomalyReport } from "./utils/anomalyDetection.js";
import { registerScanProgressClient } from "./utils/scanProgressHub.js";
import { computeEngineeringMetrics } from "./utils/engineeringMetrics.js";
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  validateCredentials,
  hasUsers,
  getUser,
} from "./utils/users.js";
import { verifyWebhookSignature, parseWebhookEvent, getWebhookSecret } from "./services/webhookHandler.js";
import { generateFixSuggestion, createFixPR } from "./services/fixer.js";
import { getAvailableProviders, getProviderName, setProvider } from "./services/aiProvider.js";
import { getMetrics, metricsMiddleware, incScanCompleted, incScanFailed, incDigestSent, incWebhook } from "./utils/metrics.js";
import { appendAudit, getAuditLog } from "./utils/auditLog.js";
import { getAlertRules, setAlertRules } from "./utils/alertRules.js";
import { createLinearIssue, createJiraIssue } from "./services/integrations.js";
import {
  safeParseBody,
  loginSchema,
  scannersConfigSchema,
  rulesConfigSchema,
  aiProviderSchema,
  suggestFixSchema,
  createPrSchema,
  createUserSchema,
  updateUserSchema,
  integrationTicketSchema,
  alertRulesSchema,
  userScheduleSchema,
  compareReposSchema,
} from "./validation/schemas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

let latestScan = getLatestScan();
let latestSummary = null;
let latestDiff = null;

if (latestScan) {
  const prev = getPreviousScan();
  if (prev) latestDiff = diffScans(latestScan, prev);
}

app.use(securityHeaders());
app.use(requestLogger());
app.use(metricsMiddleware());

// GitHub webhook: raw body must run before express.json()
app.post("/api/webhooks/github", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  const secret = getWebhookSecret();
  if (!secret) {
    return res.status(501).json({ status: "error", message: "Webhooks not configured. Set WEBHOOK_SECRET." });
  }

  const signature = req.headers["x-hub-signature-256"];
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? ""), "utf8");

  if (!verifyWebhookSignature(rawBody, signature, secret)) {
    return res.status(401).json({ status: "error", message: "Invalid webhook signature." });
  }

  const eventType = req.headers["x-github-event"];
  const parsed = parseWebhookEvent(req.body, eventType);

  if (!parsed.shouldScan) {
    return res.json({ status: "ok", action: "ignored", trigger: parsed.trigger });
  }

  incWebhook();
  res.json({ status: "ok", action: "scan_triggered", trigger: parsed.trigger });

  try {
    const previousScan = latestScan;
    latestScan = await withScanLock(() => runScan());
    saveScan(latestScan);
    invalidateTrendCache();
    latestDiff = previousScan ? diffScans(latestScan, previousScan) : null;
    incScanCompleted();
    console.log(`🪝 Webhook-triggered scan complete: ${parsed.trigger}`);
  } catch (err) {
    if (err.status === 409) return;
    incScanFailed();
    console.error("Webhook scan failed:", err.message);
  }
});

app.use(express.json({ limit: "1mb" }));

app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok", uptime: process.uptime() });
});

app.get("/readyz", (req, res) => {
  const ok = !isScanLocked() && getHistory().length >= 0;
  res.status(ok ? 200 : 503).json({ status: ok ? "ready" : "busy", scanInProgress: isScanLocked() });
});

app.get("/metrics", (req, res) => {
  res.json({ status: "ok", data: getMetrics() });
});

app.get("/api/auth", (req, res) => {
  res.json({
    enabled: isAuthEnabled(),
    hasUsers: hasUsers(),
    tokenAuth: true,
  });
});

app.post("/api/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), async (req, res) => {
  const parsed = safeParseBody(loginSchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: "error", message: parsed.message });
  }
  const { username, password } = parsed.data;

  if (!isAuthEnabled()) {
    return res.json({ status: "ok", message: "Authentication disabled." });
  }

  if (hasUsers() && username && password != null) {
    const user = await validateCredentials(username, password);
    if (!user) {
      return res.status(401).json({ status: "unauthorized", message: "Invalid username or password." });
    }
    const token = signSessionToken({ sub: user.id, role: user.role, username: user.username });
    if (!token) {
      return res.status(500).json({ status: "error", message: "JWT signing failed. Set JWT_SECRET or DASHBOARD_PASSWORD." });
    }
    return res.json({
      status: "ok",
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  }

  const envPw = process.env.DASHBOARD_PASSWORD;
  if (password != null && envPw && password === envPw) {
    const token = signSessionToken({ sub: "env", role: "admin", username: null });
    if (!token) {
      return res.status(500).json({ status: "error", message: "JWT signing failed." });
    }
    return res.json({ status: "ok", token, role: "admin" });
  }

  if (hasUsers()) {
    return res.status(401).json({ status: "unauthorized", message: "Username and password required." });
  }

  return res.status(401).json({ status: "unauthorized", message: "Invalid password." });
});

app.get("/api/status", (req, res) => {
  res.json({
    status: "ok",
    scanInProgress: isScanLocked(),
    lastScan: latestScan?.meta?.lastRun || null,
    lastError: getScanError(),
    hasSummary: !!latestSummary,
    historyCount: getHistory().length,
    hasScanData: !!latestScan,
  });
});

app.use("/api", authMiddleware);

app.use("/api", (req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return rateLimit({ windowMs: 60 * 1000, max: parseInt(process.env.API_WRITE_RATE_LIMIT || "120", 10) })(req, res, next);
  }
  next();
});

app.get("/api/me", (req, res) => {
  const sub = req.auth?.sub ?? null;
  let schedule = null;
  /** @type {string[]} */
  let visibleOrgs = [];
  if (sub && sub !== "env" && sub !== "anon") {
    const u = getUser(sub);
    const p = u?.preferences;
    if (p) {
      schedule = {
        digestFrequency: p.digestFrequency ?? "daily",
        digestHourUtc: p.digestHourUtc ?? 7,
      };
      visibleOrgs = Array.isArray(p.visibleOrgs) ? p.visibleOrgs.map((o) => String(o)) : [];
    }
  }
  res.json({
    status: "ok",
    data: {
      sub,
      role: req.auth?.role ?? "viewer",
      username: req.auth?.username ?? null,
      schedule,
      visibleOrgs,
      teamView: visibleOrgs.length > 0,
    },
  });
});

app.get("/api/scan", (req, res) => {
  if (!latestScan) {
    return res.json({ status: "no_data", message: "No scan has been run yet. POST /api/scan to trigger one." });
  }
  const org = typeof req.query.org === "string" ? req.query.org : null;
  const scoped = filterScanForRequest(latestScan, req);
  const data = groupByOrg(scoped, org);
  const diffOut = getVisibleOrgsForRequest(req) ? null : latestDiff;
  res.json({ status: "ok", data, diff: diffOut });
});

app.post("/api/scan", requireAdmin, async (req, res) => {
  try {
    const previousScan = latestScan;
    latestScan = await withScanLock(() => runScan());
    saveScan(latestScan);
    invalidateTrendCache();
    latestDiff = previousScan ? diffScans(latestScan, previousScan) : null;
    incScanCompleted();

    appendAudit({ action: "scan.completed", actor: req.auth?.sub ?? "unknown", detail: { totalItems: latestScan.meta?.totalItems } });

    latestSummary = null;
    generateDashboardSummary(latestScan)
      .then((summary) => { latestSummary = summary; })
      .catch((err) => { console.error("AI summary failed:", err.message); });

    res.json({ status: "ok", data: latestScan, diff: latestDiff });
  } catch (err) {
    const status = err.status || 500;
    if (status !== 409) {
      console.error("❌ Scan failed:", err);
      incScanFailed();
    }
    res.status(status).json({ status: status === 409 ? "busy" : "error", message: err.message });
  }
});

app.get("/api/summary", async (req, res) => {
  if (!latestScan) {
    return res.json({ status: "no_data", message: "Run a scan first." });
  }
  const viewScan = filterScanForRequest(latestScan, req);
  const teamScoped = getVisibleOrgsForRequest(req);
  if (!teamScoped && latestSummary) {
    return res.json({ status: "ok", data: latestSummary });
  }
  try {
    const summary = await generateDashboardSummary(viewScan);
    if (!teamScoped) {
      latestSummary = summary;
    }
    res.json({ status: "ok", data: summary });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post("/api/digest", requireAdmin, async (req, res) => {
  try {
    const previousScan = latestScan;
    latestScan = await withScanLock(() => runDigest());
    saveScan(latestScan);
    invalidateTrendCache();
    latestDiff = previousScan ? diffScans(latestScan, previousScan) : null;
    incDigestSent();
    appendAudit({ action: "digest.sent", actor: req.auth?.sub ?? "unknown" });
    res.json({ status: "ok", message: "Digest sent!", data: latestScan, diff: latestDiff });
  } catch (err) {
    const status = err.status || 500;
    if (status !== 409) console.error("❌ Digest failed:", err);
    res.status(status).json({ status: status === 409 ? "busy" : "error", message: err.message });
  }
});

app.get("/api/history", (req, res) => {
  const lim = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? "200"), 10) || 200));
  const all = getHistory();
  res.json({ status: "ok", data: all.slice(0, lim) });
});

app.get("/api/history/:id", (req, res) => {
  const scan = getScan(req.params.id);
  if (!scan) {
    return res.status(404).json({ status: "error", message: "Scan not found." });
  }
  res.json({ status: "ok", data: scan });
});

app.get("/api/config/scanners", (req, res) => {
  res.json({
    status: "ok",
    data: { all: getAllScannerNames(), enabled: getEnabledScanners() },
  });
});

app.post("/api/config/scanners", requireAdmin, (req, res) => {
  const parsed = safeParseBody(scannersConfigSchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: "error", message: parsed.message });
  }
  const updated = setEnabledScanners(parsed.data.scanners);
  appendAudit({ action: "config.scanners", actor: req.auth?.sub ?? "unknown", detail: { enabled: updated } });
  res.json({ status: "ok", data: { enabled: updated } });
});

app.get("/api/config/rules", (req, res) => {
  res.json({ status: "ok", data: getRules() });
});

app.post("/api/config/rules", requireAdmin, (req, res) => {
  const parsed = safeParseBody(rulesConfigSchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: "error", message: parsed.message });
  }
  const updated = setRules(parsed.data.rules);
  appendAudit({ action: "config.rules", actor: req.auth?.sub ?? "unknown" });
  res.json({ status: "ok", data: updated });
});

app.get("/api/rate-limit", (req, res) => {
  res.json({ status: "ok", data: getRateLimitInfo() });
});

app.get("/api/config/notifications", (req, res) => {
  res.json({ status: "ok", data: getNotificationChannels() });
});

app.get("/api/config/ai", (req, res) => {
  res.json({
    status: "ok",
    data: { current: getProviderName(), providers: getAvailableProviders() },
  });
});

app.post("/api/config/ai", requireAdmin, (req, res) => {
  const parsed = safeParseBody(aiProviderSchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: "error", message: parsed.message });
  }
  try {
    setProvider(parsed.data.provider);
    res.json({ status: "ok", data: { current: getProviderName(), providers: getAvailableProviders() } });
  } catch (err) {
    res.status(400).json({ status: "error", message: err.message });
  }
});

app.get("/api/trends", (req, res) => {
  const days = clampTrendDays(req.query.days);
  const orgs = getVisibleOrgsForRequest(req);
  res.json({ status: "ok", data: getTrendsCached(days, orgs) });
});

app.get("/api/trends/:category", (req, res) => {
  const days = clampTrendDays(req.query.days);
  const orgs = getVisibleOrgsForRequest(req);
  res.json({ status: "ok", data: getCategoryTrendCached(req.params.category, days, orgs) });
});

app.get("/api/plugins", async (req, res) => {
  try {
    const plugins = await loadPlugins();
    res.json({
      status: "ok",
      data: {
        dir: getPluginsDir(),
        plugins: plugins.map((p) => ({ key: p.key, category: p.category, emoji: p.emoji })),
      },
    });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.get("/api/orgs", (req, res) => {
  if (!latestScan) return res.json({ status: "ok", data: { orgs: [], summary: [] } });
  let orgs = getOrgList(latestScan);
  let summary = getOrgSummary(latestScan);
  const allow = getVisibleOrgsForRequest(req);
  if (allow?.length) {
    const allowSet = new Set(allow.map((o) => o.toLowerCase()));
    orgs = orgs.filter((o) => allowSet.has(o.toLowerCase()));
    summary = summary.filter((row) => allowSet.has(row.org.toLowerCase()));
  }
  res.json({
    status: "ok",
    data: { orgs, summary },
  });
});

app.get("/api/metrics/engineering", (req, res) => {
  if (!latestScan) {
    return res.json({ status: "ok", data: null });
  }
  const view = filterScanForRequest(latestScan, req);
  res.json({ status: "ok", data: computeEngineeringMetrics(view) });
});

app.get("/api/anomalies", (req, res) => {
  const view = latestScan ? filterScanForRequest(latestScan, req) : null;
  const prev = getPreviousScan();
  const data = buildAnomalyReport(view, prev, getAlertRules());
  res.json({ status: "ok", data });
});

app.post("/api/compare-repos", (req, res) => {
  try {
    const parsed = safeParseBody(compareReposSchema, req.body);
    if (!parsed.success) {
      return res.status(400).json({ status: "error", message: parsed.message });
    }
    if (!latestScan) {
      return res.status(404).json({ status: "error", message: "No scan data." });
    }
    const view = filterScanForRequest(latestScan, req);
    const data = compareReposInScan(view, parsed.data.repos);
    res.json({ status: "ok", data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ status: "error", message });
  }
});

app.get("/api/users", requireAdmin, (req, res) => {
  res.json({ status: "ok", data: listUsers() });
});

app.post("/api/users", requireAdmin, async (req, res) => {
  const parsed = safeParseBody(createUserSchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: "error", message: parsed.message });
  }
  try {
    const user = await createUser(parsed.data);
    appendAudit({ action: "user.created", actor: req.auth?.sub ?? "unknown", detail: { username: user.username } });
    res.status(201).json({ status: "ok", data: user });
  } catch (err) {
    res.status(400).json({ status: "error", message: err.message });
  }
});

app.put("/api/users/:id", requireAdmin, async (req, res) => {
  const parsed = safeParseBody(updateUserSchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: "error", message: parsed.message });
  }
  try {
    const user = await updateUser(req.params.id, parsed.data);
    if (!user) return res.status(404).json({ status: "error", message: "User not found." });
    appendAudit({ action: "user.updated", actor: req.auth?.sub ?? "unknown", detail: { id: req.params.id } });
    res.json({ status: "ok", data: user });
  } catch (err) {
    res.status(400).json({ status: "error", message: err.message });
  }
});

app.delete("/api/users/:id", requireAdmin, (req, res) => {
  const ok = deleteUser(req.params.id);
  if (!ok) return res.status(400).json({ status: "error", message: "Cannot delete user." });
  appendAudit({ action: "user.deleted", actor: req.auth?.sub ?? "unknown", detail: { id: req.params.id } });
  res.json({ status: "ok" });
});

app.put("/api/me/schedule", async (req, res) => {
  const parsed = safeParseBody(userScheduleSchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: "error", message: parsed.message });
  }
  const uid = req.auth?.sub;
  if (!uid || uid === "env" || uid === "anon") {
    return res.status(400).json({ status: "error", message: "Signed-in user account required." });
  }
  const user = await updateUser(uid, {
    preferences: {
      digestFrequency: parsed.data.digestFrequency,
      ...(parsed.data.digestHourUtc != null ? { digestHourUtc: parsed.data.digestHourUtc } : {}),
    },
  });
  if (!user) return res.status(404).json({ status: "error", message: "User not found." });
  res.json({ status: "ok", data: user });
});

app.get("/api/config/alerts", (req, res) => {
  res.json({ status: "ok", data: getAlertRules() });
});

app.post("/api/config/alerts", requireAdmin, (req, res) => {
  const parsed = safeParseBody(alertRulesSchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: "error", message: parsed.message });
  }
  const data = setAlertRules(parsed.data);
  appendAudit({ action: "config.alerts", actor: req.auth?.sub ?? "unknown" });
  res.json({ status: "ok", data });
});

app.post("/api/integrations/ticket", requireAdmin, async (req, res) => {
  const parsed = safeParseBody(integrationTicketSchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: "error", message: parsed.message });
  }
  const { system, title, description, teamId, issueType } = parsed.data;
  let result;
  if (system === "linear") {
    result = await createLinearIssue({ title, description: description ?? "", teamId });
  } else {
    result = await createJiraIssue({ summary: title, description: description ?? "", issueType });
  }
  if (result.error) {
    return res.status(502).json({ status: "error", message: result.message });
  }
  appendAudit({ action: "integration.ticket", actor: req.auth?.sub ?? "unknown", detail: { system } });
  res.json({ status: "ok", data: result });
});

app.get("/api/audit", requireAdmin, (req, res) => {
  const limit = Math.min(200, parseInt(String(req.query.limit ?? "50"), 10) || 50);
  res.json({ status: "ok", data: getAuditLog(limit) });
});

app.post("/api/suggest-fix", requireAdmin, async (req, res) => {
  const parsed = safeParseBody(suggestFixSchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: "error", message: parsed.message });
  }
  try {
    const suggestion = await generateFixSuggestion(parsed.data.item, parsed.data.category);
    res.json({ status: "ok", data: suggestion });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post("/api/create-pr", requireAdmin, async (req, res) => {
  const parsed = safeParseBody(createPrSchema, req.body);
  if (!parsed.success) {
    return res.status(400).json({ status: "error", message: parsed.message });
  }
  try {
    const result = await createFixPR(parsed.data);
    if (result.error) {
      return res.status(result.status || 400).json({ status: "error", message: result.message });
    }
    res.json({ status: "ok", data: result });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.get("/api/export/json", (req, res) => {
  if (!latestScan) {
    return res.status(404).json({ status: "error", message: "No scan data to export." });
  }
  const view = filterScanForRequest(latestScan, req);
  res.setHeader("Content-Disposition", `attachment; filename="github-digest-${Date.now()}.json"`);
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(view, null, 2));
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

  const view = filterScanForRequest(latestScan, req);
  for (const [cat, formatter] of Object.entries(formatters)) {
    for (const item of view[cat]?.items || []) {
      rows.push([view[cat].category || cat, ...formatter(item)]);
    }
  }

  const csv = rows.map((row) => row.map((cell) => `"${String(cell || "").replace(/"/g, '""')}"`).join(",")).join("\n");
  res.setHeader("Content-Disposition", `attachment; filename="github-digest-${Date.now()}.csv"`);
  res.setHeader("Content-Type", "text/csv");
  res.send(csv);
});

app.delete("/api/branches/:owner/:repo/:branch", requireAdmin, async (req, res) => {
  const { owner, repo, branch } = req.params;
  try {
    await octokit.rest.git.deleteRef({ owner, repo, ref: `heads/${branch}` });

    if (latestScan?.branches?.items) {
      latestScan.branches.items = latestScan.branches.items.filter(
        (b) => !(b.repo === `${owner}/${repo}` && b.branch === branch)
      );
      latestScan.branches.count = latestScan.branches.items.length;
      latestScan.meta.totalItems = Math.max(
        0,
        (latestScan.meta.totalItems ?? 0) - 1
      );
      const hid = getLatestHistoryId();
      if (hid) writeScanPayload(hid, latestScan);
    }

    appendAudit({
      action: "branch.deleted",
      actor: req.auth?.sub ?? "unknown",
      detail: { owner, repo, branch },
    });

    res.json({ status: "ok", message: `Deleted branch '${branch}' from ${owner}/${repo}` });
  } catch (err) {
    console.error(`Failed to delete branch ${branch}:`, err.message);
    res.status(err.status || 500).json({ status: "error", message: err.message });
  }
});

app.use(express.static(path.join(__dirname, "../public")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const WS_AUTH_TIMEOUT_MS = Math.min(
  120000,
  Math.max(3000, parseInt(process.env.WS_AUTH_TIMEOUT_MS || "15000", 10))
);

/**
 * @param {string} token
 * @returns {boolean}
 */
function wsTokenAllowed(token) {
  const t = typeof token === "string" ? token.trim() : "";
  if (!t) return false;
  const envPw = process.env.DASHBOARD_PASSWORD?.trim();
  const jwtOk = verifySessionToken(t);
  const legacyOk = Boolean(envPw && t === envPw);
  return Boolean(jwtOk || legacyOk);
}

/**
 * Optional: token in Sec-WebSocket-Protocol (comma-separated), e.g. `digest-auth,<jwt>`.
 * @param {import("http").IncomingMessage} req
 * @returns {string|null}
 */
function tokenFromSecWebSocketProtocol(req) {
  const raw = req.headers["sec-websocket-protocol"];
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (lower === "digest-auth" || lower === "digest") continue;
    const candidate = p.replace(/^Bearer\s+/i, "").trim();
    if (candidate && wsTokenAllowed(candidate)) return candidate;
  }
  return null;
}

function finalizeAuthenticatedScanSocket(ws) {
  registerScanProgressClient(ws);
  try {
    ws.send(JSON.stringify({ type: "scan_progress", phase: "connected", ts: Date.now() }));
  } catch {
    /* ignore */
  }
}

server.on("upgrade", (req, socket, head) => {
  try {
    const host = req.headers.host || "localhost";
    const url = new URL(req.url || "/", `http://${host}`);
    if (url.pathname !== "/ws/scan") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!isAuthEnabled()) {
        finalizeAuthenticatedScanSocket(ws);
        return;
      }

      const subprotoToken = tokenFromSecWebSocketProtocol(req);
      if (subprotoToken != null) {
        finalizeAuthenticatedScanSocket(ws);
        return;
      }

      const timer = setTimeout(() => {
        try {
          ws.close(4401, "Authentication timeout");
        } catch {
          /* ignore */
        }
      }, WS_AUTH_TIMEOUT_MS);

      const onMessage = (data) => {
        clearTimeout(timer);
        ws.off("message", onMessage);
        let token = "";
        try {
          const msg = JSON.parse(data.toString());
          if (msg && typeof msg === "object" && msg.type === "auth" && typeof msg.token === "string") {
            token = msg.token.trim();
          }
        } catch {
          /* ignore */
        }
        if (!wsTokenAllowed(token)) {
          try {
            ws.close(4401, "Unauthorized");
          } catch {
            /* ignore */
          }
          return;
        }
        finalizeAuthenticatedScanSocket(ws);
      };
      ws.on("message", onMessage);
    });
  } catch {
    socket.destroy();
  }
});

if (process.env.NODE_ENV !== "test") {
  server.listen(PORT, () => {
    console.log(`\n🌐 GitHub Digest Dashboard running at http://localhost:${PORT}`);
    console.log(`🔌 Scan WebSocket: ws://localhost:${PORT}/ws/scan`);
    console.log(`🔒 Authentication: ${isAuthEnabled() ? "ENABLED" : "disabled"}`);
    console.log(`🤖 AI Provider: ${getProviderName()}`);
    console.log(`🔍 Scanners: ${getEnabledScanners().join(", ")}`);
    console.log(`🪝 Webhooks: ${getWebhookSecret() ? "ENABLED" : "disabled"}`);
    console.log(`📁 Scan history: ${getHistory().length} entries\n`);
  });
}

export default app;
export { server };
