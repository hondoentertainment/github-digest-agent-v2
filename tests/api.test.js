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

import app from "../src/server.js";
import { runScan, runDigest } from "../src/index.js";
import { octokit } from "../src/utils/github.js";

describe("API Routes", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("GET /api/status", () => {
    it("returns health status", async () => {
      const res = await request(app).get("/api/status");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: "ok",
        scanInProgress: false,
      });
    });
  });

  describe("POST /api/scan", () => {
    it("triggers scan and returns results", async () => {
      const mockResult = {
        meta: { lastRun: new Date().toISOString(), reposScanned: 3, totalItems: 5, elapsed: "1.2s" },
        builds: { count: 1, items: [], category: "Builds", emoji: "🔴", summary: "" },
        prs: { count: 2, items: [], category: "PRs", emoji: "🔀", summary: "" },
        security: { count: 0, items: [], category: "Security", emoji: "🛡️", summary: "" },
        tokens: { count: 0, items: [], category: "Tokens", emoji: "🔑", summary: "" },
        issues: { count: 2, items: [], category: "Issues", emoji: "🐛", summary: "" },
        branches: { count: 0, items: [], category: "Branches", emoji: "🌿", summary: "" },
      };
      runScan.mockResolvedValue(mockResult);

      const res = await request(app).post("/api/scan");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.data.meta.reposScanned).toBe(3);
    });

    it("returns 500 on scan failure", async () => {
      runScan.mockRejectedValue(new Error("GitHub API down"));

      const res = await request(app).post("/api/scan");
      expect(res.status).toBe(500);
      expect(res.body.status).toBe("error");
    });
  });

  describe("DELETE /api/branches/:owner/:repo/:branch", () => {
    it("deletes a branch successfully", async () => {
      octokit.rest.git.deleteRef.mockResolvedValue({});

      const res = await request(app).delete("/api/branches/user/repo/stale-branch");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(octokit.rest.git.deleteRef).toHaveBeenCalledWith({
        owner: "user",
        repo: "repo",
        ref: "heads/stale-branch",
      });
    });

    it("returns error on deletion failure", async () => {
      octokit.rest.git.deleteRef.mockRejectedValue({
        status: 422,
        message: "Reference does not exist",
      });

      const res = await request(app).delete("/api/branches/user/repo/nonexistent");
      expect(res.status).toBe(422);
      expect(res.body.status).toBe("error");
    });
  });

  describe("POST /api/digest", () => {
    it("runs full digest pipeline", async () => {
      const mockResult = {
        meta: { lastRun: new Date().toISOString(), reposScanned: 5, totalItems: 8, elapsed: "3.1s" },
        builds: { count: 0, items: [] },
        prs: { count: 0, items: [] },
        security: { count: 0, items: [] },
        tokens: { count: 0, items: [] },
        issues: { count: 0, items: [] },
        branches: { count: 0, items: [] },
      };
      runDigest.mockResolvedValue(mockResult);

      const res = await request(app).post("/api/digest");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.message).toContain("Digest sent");
    });
  });
});
