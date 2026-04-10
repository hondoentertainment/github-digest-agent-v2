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
  octokit: {
    rest: {
      git: { deleteRef: vi.fn() },
    },
  },
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

import app from "../src/server.js";
import { runScan, runDigest } from "../src/index.js";
import { octokit } from "../src/utils/github.js";
import { saveScan, getHistory, getScan } from "../src/utils/storage.js";
import { setEnabledScanners } from "../src/utils/scannerConfig.js";

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
      expect(res.body.status).toBe("ok");
    });
  });

  // --- Protected routes ---

  describe("GET /api/status", () => {
    it("returns health status with history count", async () => {
      const res = await request(app).get("/api/status");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "ok", scanInProgress: false });
      expect(res.body).toHaveProperty("historyCount");
    });
  });

  // --- Export (tested before POST /api/scan sets latestScan) ---

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
      expect(res.body.data[0].id).toBe("abc");
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
    it("returns all and enabled scanners", async () => {
      const res = await request(app).get("/api/config/scanners");
      expect(res.status).toBe(200);
      expect(res.body.data.all).toHaveLength(6);
      expect(res.body.data.enabled).toHaveLength(6);
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

  // --- Export (with data, after POST /api/scan has run) ---

  describe("GET /api/export/json (with data)", () => {
    it("returns JSON file when data exists", async () => {
      const res = await request(app).get("/api/export/json");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/json/);
    });
  });

  describe("GET /api/export/csv (with data)", () => {
    it("returns CSV file when data exists", async () => {
      const res = await request(app).get("/api/export/csv");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/csv/);
    });
  });

  // --- Branch Delete ---

  describe("DELETE /api/branches/:owner/:repo/:branch", () => {
    it("deletes a branch successfully", async () => {
      octokit.rest.git.deleteRef.mockResolvedValue({});
      const res = await request(app).delete("/api/branches/user/repo/stale-branch");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(octokit.rest.git.deleteRef).toHaveBeenCalledWith({ owner: "user", repo: "repo", ref: "heads/stale-branch" });
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
      expect(res.body.status).toBe("ok");
      expect(res.body.message).toContain("Digest sent");
      expect(saveScan).toHaveBeenCalled();
    });
  });
});
