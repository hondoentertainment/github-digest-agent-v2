import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/storage.js", () => ({
  getHistory: vi.fn(),
  getScan: vi.fn(),
}));

import { getHistory, getScan } from "../src/utils/storage.js";
import { getTrends } from "../src/utils/trends.js";
import { trendScopeKey } from "../src/utils/viewScope.js";
import { invalidateTrendCache, getTrendsCached } from "../src/utils/trendCache.js";

describe("trendScopeKey", () => {
  it("returns empty string for full-dashboard (no restriction)", () => {
    expect(trendScopeKey(null)).toBe("");
    expect(trendScopeKey([])).toBe("");
  });

  it("sorts and dedupes org keys", () => {
    expect(trendScopeKey(["z", "a", "a"])).toBe("a|z");
  });
});

describe("getTrends scoped", () => {
  beforeEach(() => {
    const ts = new Date().toISOString();
    vi.mocked(getHistory).mockReturnValue([{ id: "s1", timestamp: ts }]);
    invalidateTrendCache();
  });

  it("uses lower counts when filtering by org", () => {
    vi.mocked(getScan).mockReturnValue({
      meta: { totalItems: 10 },
      builds: {
        count: 2,
        items: [{ repo: "acme/a" }, { repo: "other/b" }],
      },
      prs: { count: 0, items: [] },
      security: { count: 0, items: [] },
      tokens: { count: 0, items: [] },
      issues: { count: 0, items: [] },
      branches: { count: 0, items: [] },
    });

    const fleet = getTrends(30, null);
    const scoped = getTrends(30, ["acme"]);

    expect(fleet.series.builds[fleet.series.builds.length - 1]).toBe(2);
    expect(scoped.series.builds[scoped.series.builds.length - 1]).toBe(1);
  });
});

describe("getTrendsCached per scope", () => {
  beforeEach(() => {
    invalidateTrendCache();
    const ts = new Date().toISOString();
    vi.mocked(getHistory).mockReturnValue([{ id: "s1", timestamp: ts }]);
    vi.mocked(getScan).mockReturnValue({
      meta: { totalItems: 1 },
      builds: { count: 1, items: [{ repo: "acme/r" }] },
      prs: { count: 0, items: [] },
      security: { count: 0, items: [] },
      tokens: { count: 0, items: [] },
      issues: { count: 0, items: [] },
      branches: { count: 0, items: [] },
    });
  });

  it("caches separately for different org scopes", () => {
    const a = getTrendsCached(30, ["acme"]);
    const b = getTrendsCached(30, ["other"]);
    expect(a.summary.avgTotal).not.toBe(b.summary.avgTotal);
  });
});
