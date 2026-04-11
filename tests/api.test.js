import { vi, describe, it, expect, beforeEach } from "vitest";
import request from "supertest";

vi.mock("../src/index.js", () => ({
  runScan: vi.fn(),
  runDigest: vi.fn(),
}));

vi.mock("../src/services/dashboardSummary.js", () => ({
  generateDashboardSummary: vi.fn().mockResolvedValue({
    topOfMind: "Test summary",
    actions: [],
    categoryInsights: {},
  }),
}));

vi.mock("../src/utils/github.js", () => ({
  octokit: { rest: { git: { deleteRef: vi.fn() } } },
  getRateLimitInfo: vi.fn(() => ({ limit: 5000, remaining: 4800, used: 200, reset: 0, resetAt: null })),
}));

vi.mock("../src/utils/storage.js", () => ({
  saveScan: vi.fn(),
  getLatestScan: vi.fn(() => null),
  getPreviousScan: vi.fn(() => null),
  getHistory: vi.fn(() => []),
  getScan: vi.fn(() => null),
}));

vi.mock("../src/middleware/auth.js", () => ({
  authMiddleware: vi.fn((req, res, next) => next()),
  isAuthEnabled: vi.fn(() => false),
}));

vi.mock("../src/utils/scannerConfig.js", () => ({
  getEnabledScanners: vi.fn(() => ["builds", "prs", "security", "tokens", "issues", "branches"]),
  setEnabledScanners: vi.fn((s) => s),
  getAllScannerNames: vi.fn(() => ["builds", "prs", "security", "tokens", "issues", "branches"]),
}));

vi.mock("../src/utils/diff.js", () => ({
  diffScans: vi.fn(() => null),
}));

vi.mock("../src/utils/scanLock.js", async () => {
  let locked = false;
  return {
    isScanLocked: vi.fn(() => locked),
    getScanError: vi.fn(() => null),
    withScanLock: vi.fn(async (fn) => {
      if (locked) { const e = new Error("busy"); e.status = 409; throw e; }
      locked = true;
      try { return await fn(); } finally { locked = false; }
    }),
  };
});

vi.mock("../src/services/notifier.js", () => ({
  getNotificationChannels: vi.fn(() => ({ slack: false, discord: false })),
  sendNotifications: vi.fn(),
}));

vi.mock("../src/utils/scanRules.js", () => ({
  getRules: vi.fn(() => ({ staleBranchDays: 30, buildWindowHours: 24, severityThreshold: "low", maxItemsPerScanner: 100 })),
  setRules: vi.fn((r) => r),
}));

vi.mock("../src/middleware/rateLimit.js", () => ({
  rateLimit: vi.fn(() => (req, res, next) => next()),
}));

vi.mock("../src/middleware/securityHeaders.js", () => ({
  securityHeaders: vi.fn(() => (req, res, next) => next()),
}));

vi.mock("../src/middleware/requestLogger.js", () => ({
  requestLogger: vi.fn(() => (req, res, next) => next()),
}));

vi.mock("../src/utils/trends.js", () => ({
  getTrends: vi.fn(() => ({ labels: [], series: {}, summary: { avgTotal: 0, trend: "stable", peakDate: null, peakTotal: 0 } })),
  getCategoryTrend: vi.fn(() => ({ labels: [], values: [], change: 0, changePercent: 0 })),
}));

vi.mock("../src/utils/pluginLoader.js", () => ({
  loadPlugins: vi.fn(async () => []),
  getPluginsDir: vi.fn(() => "/plugins"),
}));

vi.mock("../src/utils/orgGrouper.js", () => ({
  getOrgList: vi.fn(() => []),
  groupByOrg: vi.fn((data) => data),
  getOrgSummary: vi.fn(() => []),
}));

vi.mock("../src/utils/users.js", () => ({
  listUsers: vi.fn(() => []),
  getUser: vi.fn(() => null),
  createUser: vi.fn(({ username, role }) => ({ id: "u1", username, role: role || "viewer" })),
  updateUser: vi.fn(() => null),
  deleteUser: vi.fn(() => true),
  validateCredentials: vi.fn(() => null),
}));

vi.mock("../src/services/webhookHandler.js", () => ({
  verifyWebhookSignature: vi.fn(() => true),
  parseWebhookEvent: vi.fn(() => ({ action: null, repo: null, trigger: "test", shouldScan: false })),
  getWebhookSecret: vi.fn(() => null),
}));

vi.mock("../src/services/fixer.js", () => ({
  generateFixSuggestion: vi.fn(async () => ({ summary: "Fix it", steps: ["Step 1"], confidence: "high", canAutoPR: false, suggestedBranch: null })),
  canSuggestFix: vi.fn(() => true),
  createFixPR: vi.fn(async () => ({ prUrl: "https://github.com/test/pr/1", prNumber: 1, branch: "fix/test" })),
}));

vi.mock("../src/services/aiProvider.js", () => ({
  getAvailableProviders: vi.fn(() => [
    { id: "claude", name: "Claude", configured: true },
    { id: "openai", name: "OpenAI", configured: false },
    { id: "gemini", name: "Gemini", configured: false },
  ]),
  getProviderName: vi.fn(() => "claude"),
  setProvider: vi.fn(),
  createCompletion: vi.fn(async () => "test"),
}));

import app from "../src/server.js";
import { runScan, runDigest } from "../src/index.js";
import { octokit } from "../src/utils/github.js";
import { saveScan, getHistory, getScan } from "../src/utils/storage.js";
import { setEnabledScanners } from "../src/utils/scannerConfig.js";
import { setRules } from "../src/utils/scanRules.js";
import { createUser, deleteUser } from "../src/utils/users.js";

const mockScanResult = {
  meta: { lastRun: new Date().toISOString(), reposScanned: 3, totalItems: 5, elapsed: "1.2s" },
  builds: { count: 1, items: [{ repo: "u/r", workflow: "CI", branch: "main", conclusion: "failure", message: "test", url: "#", created: new Date().toISOString() }], category: "Builds", emoji: "🔴", summary: "" },
  prs: { count: 2, items: [], category: "PRs", emoji: "🔀", summary: "" },
  security: { count: 0, items: [], category: "Security", emoji: "🛡️", summary: "" },
  tokens: { count: 0, items: [], category: "Tokens", emoji: "🔑", summary: "" },
  issues: { count: 2, items: [], category: "Issues", emoji: "🐛", summary: "" },
  branches: { count: 0, items: [], category: "Branches", emoji: "🌿", summary: "" },
};

describe("API Routes", () => {
  beforeEach(() => vi.clearAllMocks());

  // --- Public routes ---

  describe("GET /api/auth", () => {
    it("returns auth status", async () => {
      const res = await request(app).get("/api/auth");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("enabled");
    });
  });

  describe("POST /api/login", () => {
    it("succeeds when auth is disabled", async () => {
      const res = await request(app).post("/api/login").send({ password: "anything" });
      expect(res.status).toBe(200);
    });
  });

  describe("GET /api/status (public)", () => {
    it("returns health status without auth", async () => {
      const res = await request(app).get("/api/status");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "ok" });
      expect(res.body).toHaveProperty("historyCount");
    });
  });

  // --- Export (no data yet) ---

  describe("GET /api/export/json (no data)", () => {
    it("returns 404 when no scan data", async () => {
      const res = await request(app).get("/api/export/json");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/export/csv (no data)", () => {
    it("returns 404 when no scan data", async () => {
      const res = await request(app).get("/api/export/csv");
      expect(res.status).toBe(404);
    });
  });

  // --- Scan (sets latestScan for subsequent tests) ---

  describe("POST /api/scan", () => {
    it("triggers scan, saves to storage, returns results", async () => {
      runScan.mockResolvedValue(mockScanResult);
      const res = await request(app).post("/api/scan");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.meta.reposScanned).toBe(3);
      expect(saveScan).toHaveBeenCalledOnce();
    });

    it("returns 500 on scan failure", async () => {
      runScan.mockRejectedValue(new Error("GitHub API down"));
      const res = await request(app).post("/api/scan");
      expect(res.status).toBe(500);
      expect(res.body.status).toBe("error");
    });
  });

  // --- History ---

  describe("GET /api/history", () => {
    it("returns scan history array", async () => {
      getHistory.mockReturnValue([{ id: "abc", timestamp: "2025-01-01", totalItems: 5, reposScanned: 3, elapsed: "1s" }]);
      const res = await request(app).get("/api/history");
      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
    });
  });

  describe("GET /api/history/:id", () => {
    it("returns a specific scan", async () => {
      getScan.mockReturnValue(mockScanResult);
      const res = await request(app).get("/api/history/abc");
      expect(res.status).toBe(200);
      expect(res.body.data.meta.reposScanned).toBe(3);
    });

    it("returns 404 for unknown scan", async () => {
      getScan.mockReturnValue(null);
      const res = await request(app).get("/api/history/unknown");
      expect(res.status).toBe(404);
    });
  });

  // --- Scanner Config ---

  describe("GET /api/config/scanners", () => {
    it("returns scanner configuration", async () => {
      const res = await request(app).get("/api/config/scanners");
      expect(res.status).toBe(200);
      expect(res.body.data.all).toHaveLength(6);
    });
  });

  describe("POST /api/config/scanners", () => {
    it("updates enabled scanners", async () => {
      setEnabledScanners.mockReturnValue(["builds", "prs"]);
      const res = await request(app).post("/api/config/scanners").send({ scanners: ["builds", "prs"] });
      expect(res.status).toBe(200);
      expect(res.body.data.enabled).toEqual(["builds", "prs"]);
    });

    it("rejects non-array input", async () => {
      const res = await request(app).post("/api/config/scanners").send({ scanners: "builds" });
      expect(res.status).toBe(400);
    });
  });

  // --- Scan Rules ---

  describe("GET /api/config/rules", () => {
    it("returns scan rules", async () => {
      const res = await request(app).get("/api/config/rules");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("staleBranchDays");
    });
  });

  describe("POST /api/config/rules", () => {
    it("updates scan rules", async () => {
      setRules.mockReturnValue({ staleBranchDays: 60, buildWindowHours: 48, severityThreshold: "high", maxItemsPerScanner: 50 });
      const res = await request(app).post("/api/config/rules").send({ rules: { staleBranchDays: 60 } });
      expect(res.status).toBe(200);
    });
  });

  // --- Rate Limit ---

  describe("GET /api/rate-limit", () => {
    it("returns rate limit info", async () => {
      const res = await request(app).get("/api/rate-limit");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("limit");
    });
  });

  // --- Notifications ---

  describe("GET /api/config/notifications", () => {
    it("returns notification channel status", async () => {
      const res = await request(app).get("/api/config/notifications");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("slack");
    });
  });

  // --- AI Provider ---

  describe("GET /api/config/ai", () => {
    it("returns AI provider info", async () => {
      const res = await request(app).get("/api/config/ai");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("current");
      expect(res.body.data).toHaveProperty("providers");
      expect(res.body.data.current).toBe("claude");
    });
  });

  describe("POST /api/config/ai", () => {
    it("updates AI provider", async () => {
      const res = await request(app).post("/api/config/ai").send({ provider: "openai" });
      expect(res.status).toBe(200);
    });
  });

  // --- Trends ---

  describe("GET /api/trends", () => {
    it("returns trend data", async () => {
      const res = await request(app).get("/api/trends");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("labels");
      expect(res.body.data).toHaveProperty("summary");
    });
  });

  describe("GET /api/trends/:category", () => {
    it("returns category trend", async () => {
      const res = await request(app).get("/api/trends/builds");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("change");
    });
  });

  // --- Plugins ---

  describe("GET /api/plugins", () => {
    it("returns plugin list", async () => {
      const res = await request(app).get("/api/plugins");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("plugins");
      expect(res.body.data.plugins).toBeInstanceOf(Array);
    });
  });

  // --- Organizations ---

  describe("GET /api/orgs", () => {
    it("returns org list", async () => {
      const res = await request(app).get("/api/orgs");
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("orgs");
    });
  });

  // --- Users ---

  describe("GET /api/users", () => {
    it("returns user list", async () => {
      const res = await request(app).get("/api/users");
      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
    });
  });

  describe("POST /api/users", () => {
    it("creates a new user", async () => {
      const res = await request(app).post("/api/users").send({ username: "test", password: "pass123" });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty("username");
    });
  });

  describe("DELETE /api/users/:id", () => {
    it("deletes a user", async () => {
      const res = await request(app).delete("/api/users/u1");
      expect(res.status).toBe(200);
    });
  });

  // --- Fix Suggestions ---

  describe("POST /api/suggest-fix", () => {
    it("returns fix suggestion", async () => {
      const res = await request(app).post("/api/suggest-fix").send({ item: { repo: "u/r", title: "Bug" }, category: "issues" });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("summary");
      expect(res.body.data).toHaveProperty("steps");
    });

    it("rejects missing params", async () => {
      const res = await request(app).post("/api/suggest-fix").send({});
      expect(res.status).toBe(400);
    });
  });

  // --- Export (with data) ---

  describe("GET /api/export/json (with data)", () => {
    it("returns JSON file", async () => {
      const res = await request(app).get("/api/export/json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/json/);
    });
  });

  describe("GET /api/export/csv (with data)", () => {
    it("returns CSV file", async () => {
      const res = await request(app).get("/api/export/csv");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/csv/);
    });
  });

  // --- Branch Delete ---

  describe("DELETE /api/branches/:owner/:repo/:branch", () => {
    it("deletes branch and persists", async () => {
      octokit.rest.git.deleteRef.mockResolvedValue({});
      const res = await request(app).delete("/api/branches/user/repo/stale-branch");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });

    it("returns error on deletion failure", async () => {
      octokit.rest.git.deleteRef.mockRejectedValue({ status: 422, message: "Reference does not exist" });
      const res = await request(app).delete("/api/branches/user/repo/nonexistent");
      expect(res.status).toBe(422);
    });
  });

  // --- Digest ---

  describe("POST /api/digest", () => {
    it("runs full digest pipeline and saves", async () => {
      runDigest.mockResolvedValue(mockScanResult);
      const res = await request(app).post("/api/digest");
      expect(res.status).toBe(200);
      expect(res.body.message).toContain("Digest sent");
      expect(saveScan).toHaveBeenCalled();
    });
  });
});
