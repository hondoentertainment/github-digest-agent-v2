import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../src/utils/github.js", () => ({
  octokit: {
    rest: {
      actions: { listWorkflowRunsForRepo: vi.fn() },
      pulls: { list: vi.fn(), listRequestedReviewers: vi.fn(), listReviews: vi.fn() },
      dependabot: { listAlertsForRepo: vi.fn() },
      codeScanning: { listAlertsForRepo: vi.fn() },
      secretScanning: { listAlertsForRepo: vi.fn() },
      repos: { listBranches: vi.fn(), getCommit: vi.fn(), listDeployKeys: vi.fn(), listWebhooks: vi.fn() },
      rateLimit: { get: vi.fn() },
      issues: { listForRepo: vi.fn() },
    },
  },
  getAllRepos: vi.fn(),
}));

import { octokit } from "../src/utils/github.js";
import { scanFailedBuilds } from "../src/scanners/builds.js";
import { scanStaleBranches } from "../src/scanners/branches.js";
import { scanOpenIssues } from "../src/scanners/issues.js";
import { scanOpenPRs } from "../src/scanners/pullRequests.js";
import { scanSecurityAlerts } from "../src/scanners/security.js";
import { scanExpiredTokens } from "../src/scanners/tokens.js";

const mockRepo = {
  full_name: "user/test-repo",
  name: "test-repo",
  owner: { login: "user" },
  default_branch: "main",
  archived: false,
};

// ── Builds ───────────────────────────────────────────────────────

describe("scanFailedBuilds", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns correct structure with no failures", async () => {
    octokit.rest.actions.listWorkflowRunsForRepo.mockResolvedValue({
      data: { workflow_runs: [] },
    });

    const result = await scanFailedBuilds([mockRepo]);
    expect(result).toMatchObject({
      category: "Failed CI/Build Issues",
      emoji: "🔴",
      count: 0,
      items: [],
    });
  });

  it("captures failed workflow runs", async () => {
    octokit.rest.actions.listWorkflowRunsForRepo.mockResolvedValue({
      data: {
        workflow_runs: [
          {
            name: "CI",
            head_branch: "main",
            head_commit: { message: "fix tests" },
            html_url: "https://github.com/user/test-repo/actions/runs/1",
            created_at: new Date().toISOString(),
            conclusion: "failure",
          },
        ],
      },
    });

    const result = await scanFailedBuilds([mockRepo]);
    expect(result.count).toBe(1);
    expect(result.items[0]).toMatchObject({
      repo: "user/test-repo",
      workflow: "CI",
      branch: "main",
    });
  });

  it("handles 403/404 errors gracefully", async () => {
    octokit.rest.actions.listWorkflowRunsForRepo.mockRejectedValue({ status: 403 });
    const result = await scanFailedBuilds([mockRepo]);
    expect(result.count).toBe(0);
  });

  it("handles multiple repos", async () => {
    const repo2 = { ...mockRepo, full_name: "user/repo-2", name: "repo-2" };
    octokit.rest.actions.listWorkflowRunsForRepo
      .mockResolvedValueOnce({ data: { workflow_runs: [] } })
      .mockResolvedValueOnce({
        data: {
          workflow_runs: [
            {
              name: "Deploy",
              head_branch: "dev",
              head_commit: { message: "deploy fix" },
              html_url: "https://github.com/user/repo-2/actions/runs/2",
              created_at: new Date().toISOString(),
              conclusion: "failure",
            },
          ],
        },
      });

    const result = await scanFailedBuilds([mockRepo, repo2]);
    expect(result.count).toBe(1);
    expect(result.items[0].repo).toBe("user/repo-2");
  });
});

// ── Branches ─────────────────────────────────────────────────────

describe("scanStaleBranches", () => {
  beforeEach(() => vi.clearAllMocks());

  it("identifies stale branches", async () => {
    const staleDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    octokit.rest.repos.listBranches.mockResolvedValue({
      data: [
        { name: "main", commit: { sha: "abc" }, protected: false },
        { name: "old-feature", commit: { sha: "def" }, protected: false },
      ],
    });

    octokit.rest.repos.getCommit.mockResolvedValue({
      data: {
        commit: {
          committer: { date: staleDate },
          author: { name: "dev", date: staleDate },
        },
      },
    });

    const result = await scanStaleBranches([mockRepo]);
    expect(result.count).toBe(1);
    expect(result.items[0].branch).toBe("old-feature");
    expect(result.items[0].ageDays).toBeGreaterThan(30);
  });

  it("skips default branch", async () => {
    octokit.rest.repos.listBranches.mockResolvedValue({
      data: [{ name: "main", commit: { sha: "abc" }, protected: false }],
    });

    const result = await scanStaleBranches([mockRepo]);
    expect(result.count).toBe(0);
    expect(octokit.rest.repos.getCommit).not.toHaveBeenCalled();
  });

  it("marks protected branches", async () => {
    const staleDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    octokit.rest.repos.listBranches.mockResolvedValue({
      data: [
        { name: "main", commit: { sha: "abc" }, protected: false },
        { name: "release", commit: { sha: "ghi" }, protected: true },
      ],
    });

    octokit.rest.repos.getCommit.mockResolvedValue({
      data: {
        commit: {
          committer: { date: staleDate },
          author: { name: "dev", date: staleDate },
        },
      },
    });

    const result = await scanStaleBranches([mockRepo]);
    expect(result.items[0].protected).toBe(true);
  });
});

// ── Issues ───────────────────────────────────────────────────────

describe("scanOpenIssues", () => {
  beforeEach(() => vi.clearAllMocks());

  it("filters out pull requests from issues list", async () => {
    octokit.rest.issues.listForRepo.mockResolvedValue({
      data: [
        {
          number: 1, title: "Bug report", user: { login: "dev" },
          html_url: "https://github.com/user/test-repo/issues/1",
          created_at: new Date().toISOString(),
          labels: [], assignees: [], comments: 0,
        },
        {
          number: 2, title: "PR title", user: { login: "dev" },
          html_url: "https://github.com/user/test-repo/pull/2",
          created_at: new Date().toISOString(),
          labels: [], assignees: [], comments: 0,
          pull_request: { url: "..." },
        },
      ],
    });

    const result = await scanOpenIssues([mockRepo]);
    expect(result.count).toBe(1);
    expect(result.items[0].title).toBe("Bug report");
  });

  it("prioritizes bugs over other issues", async () => {
    octokit.rest.issues.listForRepo.mockResolvedValue({
      data: [
        {
          number: 1, title: "Feature request", user: { login: "dev" },
          html_url: "#", created_at: new Date().toISOString(),
          labels: [{ name: "feature" }], assignees: [], comments: 0,
        },
        {
          number: 2, title: "Critical bug", user: { login: "dev" },
          html_url: "#", created_at: new Date().toISOString(),
          labels: [{ name: "bug" }], assignees: [], comments: 3,
        },
      ],
    });

    const result = await scanOpenIssues([mockRepo]);
    expect(result.items[0].title).toBe("Critical bug");
    expect(result.items[0].isBug).toBe(true);
    expect(result.items[1].isBug).toBe(false);
  });

  it("returns empty results for repos with no issues", async () => {
    octokit.rest.issues.listForRepo.mockResolvedValue({ data: [] });
    const result = await scanOpenIssues([mockRepo]);
    expect(result.count).toBe(0);
    expect(result.summary).toContain("No open issues");
  });
});

// ── PRs ──────────────────────────────────────────────────────────

describe("scanOpenPRs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns PR details with review info", async () => {
    octokit.rest.pulls.list.mockResolvedValue({
      data: [
        {
          number: 10, title: "Add feature", user: { login: "contributor" },
          html_url: "https://github.com/user/test-repo/pull/10",
          created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          draft: false, labels: [{ name: "enhancement" }],
          mergeable_state: "clean",
        },
      ],
    });

    octokit.rest.pulls.listRequestedReviewers.mockResolvedValue({
      data: { users: [{ login: "reviewer1" }] },
    });

    octokit.rest.pulls.listReviews.mockResolvedValue({
      data: [{ id: 1 }],
    });

    const result = await scanOpenPRs([mockRepo]);
    expect(result.count).toBe(1);
    expect(result.items[0]).toMatchObject({
      number: 10,
      title: "Add feature",
      author: "contributor",
      ageDays: 3,
      reviewCount: 1,
    });
    expect(result.items[0].reviewers).toContain("reviewer1");
  });
});

// ── Security ─────────────────────────────────────────────────────

describe("scanSecurityAlerts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("aggregates alerts from all sources", async () => {
    octokit.rest.dependabot.listAlertsForRepo.mockResolvedValue({
      data: [
        {
          security_advisory: { severity: "high", summary: "XSS vulnerability" },
          security_vulnerability: { package: { name: "lodash" } },
          html_url: "#", created_at: new Date().toISOString(),
        },
      ],
    });
    octokit.rest.codeScanning.listAlertsForRepo.mockRejectedValue({ status: 404 });
    octokit.rest.secretScanning.listAlertsForRepo.mockRejectedValue({ status: 404 });

    const result = await scanSecurityAlerts([mockRepo]);
    expect(result.count).toBe(1);
    expect(result.items[0].type).toBe("dependabot");
    expect(result.items[0].severity).toBe("high");
  });

  it("sorts by severity", async () => {
    octokit.rest.dependabot.listAlertsForRepo.mockResolvedValue({
      data: [
        {
          security_advisory: { severity: "low", summary: "Minor issue" },
          security_vulnerability: { package: { name: "pkg-a" } },
          html_url: "#", created_at: new Date().toISOString(),
        },
        {
          security_advisory: { severity: "critical", summary: "RCE" },
          security_vulnerability: { package: { name: "pkg-b" } },
          html_url: "#", created_at: new Date().toISOString(),
        },
      ],
    });
    octokit.rest.codeScanning.listAlertsForRepo.mockRejectedValue({ status: 404 });
    octokit.rest.secretScanning.listAlertsForRepo.mockRejectedValue({ status: 404 });

    const result = await scanSecurityAlerts([mockRepo]);
    expect(result.items[0].severity).toBe("critical");
    expect(result.items[1].severity).toBe("low");
  });
});

// ── Tokens ───────────────────────────────────────────────────────

describe("scanExpiredTokens", () => {
  beforeEach(() => vi.clearAllMocks());

  it("detects expiring PAT", async () => {
    const expDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    octokit.rest.rateLimit.get.mockResolvedValue({
      headers: { "github-authentication-token-expiration": expDate },
    });
    octokit.rest.repos.listDeployKeys.mockResolvedValue({ data: [] });
    octokit.rest.repos.listWebhooks.mockResolvedValue({ data: [] });

    const result = await scanExpiredTokens([mockRepo]);
    expect(result.count).toBe(1);
    expect(result.items[0].type).toBe("pat-expiration");
  });

  it("detects failing webhooks", async () => {
    octokit.rest.rateLimit.get.mockResolvedValue({ headers: {} });
    octokit.rest.repos.listDeployKeys.mockResolvedValue({ data: [] });
    octokit.rest.repos.listWebhooks.mockResolvedValue({
      data: [
        { id: 1, config: { url: "https://example.com/hook" }, last_response: { code: 500 } },
      ],
    });

    const result = await scanExpiredTokens([mockRepo]);
    expect(result.count).toBe(1);
    expect(result.items[0].type).toBe("webhook-failure");
  });
});
