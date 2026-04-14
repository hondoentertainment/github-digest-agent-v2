import { describe, it, expect } from "vitest";
import { filterScanByOrgAllowList, compareReposInScan } from "../src/utils/orgGrouper.js";

const sample = {
  meta: { lastRun: "2025-01-01", totalItems: 3, reposScanned: 2 },
  builds: { count: 2, items: [{ repo: "acme/a" }, { repo: "other/b" }], category: "Builds", emoji: "🔴" },
  prs: { count: 1, items: [{ repo: "acme/a" }], category: "PRs", emoji: "🔀" },
  security: { count: 0, items: [], category: "Security", emoji: "🛡️" },
  tokens: { count: 0, items: [], category: "Tokens", emoji: "🔑" },
  issues: { count: 0, items: [], category: "Issues", emoji: "🐛" },
  branches: { count: 0, items: [], category: "Branches", emoji: "🌿" },
};

describe("filterScanByOrgAllowList", () => {
  it("returns original when org list empty", () => {
    expect(filterScanByOrgAllowList(sample, [])).toBe(sample);
  });

  it("filters to allowed org", () => {
    const out = filterScanByOrgAllowList(sample, ["acme"]);
    expect(out.builds.count).toBe(1);
    expect(out.builds.items[0].repo).toBe("acme/a");
    expect(out.meta.totalItems).toBe(2);
    expect(out.meta.teamFilter).toEqual(["acme"]);
  });
});

describe("compareReposInScan", () => {
  it("returns per-repo breakdown", () => {
    const out = compareReposInScan(sample, ["acme/a", "other/b"]);
    expect(out.repos).toHaveLength(2);
    expect(out.repos[0].totalItems).toBeGreaterThanOrEqual(0);
  });
});
