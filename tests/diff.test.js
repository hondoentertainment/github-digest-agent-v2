import { describe, it, expect } from "vitest";
import { diffScans } from "../src/utils/diff.js";

const makeScan = (overrides = {}) => ({
  meta: { lastRun: new Date().toISOString(), reposScanned: 5, totalItems: 0, elapsed: "1s" },
  builds: { count: 0, items: [], category: "Builds", emoji: "🔴", summary: "" },
  prs: { count: 0, items: [], category: "PRs", emoji: "🔀", summary: "" },
  security: { count: 0, items: [], category: "Security", emoji: "🛡️", summary: "" },
  tokens: { count: 0, items: [], category: "Tokens", emoji: "🔑", summary: "" },
  issues: { count: 0, items: [], category: "Issues", emoji: "🐛", summary: "" },
  branches: { count: 0, items: [], category: "Branches", emoji: "🌿", summary: "" },
  ...overrides,
});

describe("diffScans", () => {
  it("returns null when previous scan is missing", () => {
    expect(diffScans(makeScan(), null)).toBeNull();
  });

  it("returns null when current scan is missing", () => {
    expect(diffScans(null, makeScan())).toBeNull();
  });

  it("detects new items", () => {
    const prev = makeScan();
    const curr = makeScan({
      builds: {
        count: 1,
        items: [{ repo: "u/r", workflow: "CI", branch: "main" }],
      },
    });

    const diff = diffScans(curr, prev);
    expect(diff.builds.new).toBe(1);
    expect(diff.builds.resolved).toBe(0);
    expect(diff.summary.totalNew).toBe(1);
  });

  it("detects resolved items", () => {
    const prev = makeScan({
      issues: {
        count: 2,
        items: [
          { repo: "u/r", number: 1 },
          { repo: "u/r", number: 2 },
        ],
      },
    });
    const curr = makeScan({
      issues: {
        count: 1,
        items: [{ repo: "u/r", number: 1 }],
      },
    });

    const diff = diffScans(curr, prev);
    expect(diff.issues.new).toBe(0);
    expect(diff.issues.resolved).toBe(1);
    expect(diff.issues.delta).toBe(-1);
    expect(diff.summary.totalResolved).toBe(1);
  });

  it("handles mixed new and resolved", () => {
    const prev = makeScan({
      prs: {
        count: 2,
        items: [
          { repo: "u/r", number: 10 },
          { repo: "u/r", number: 11 },
        ],
      },
    });
    const curr = makeScan({
      prs: {
        count: 2,
        items: [
          { repo: "u/r", number: 11 },
          { repo: "u/r", number: 12 },
        ],
      },
    });

    const diff = diffScans(curr, prev);
    expect(diff.prs.new).toBe(1);
    expect(diff.prs.resolved).toBe(1);
    expect(diff.prs.delta).toBe(0);
  });

  it("returns zeros when scans are identical", () => {
    const scan = makeScan({
      security: {
        count: 1,
        items: [{ repo: "u/r", type: "dependabot", package: "lodash", title: "XSS" }],
      },
    });

    const diff = diffScans(scan, scan);
    expect(diff.security.new).toBe(0);
    expect(diff.security.resolved).toBe(0);
    expect(diff.summary.totalNew).toBe(0);
    expect(diff.summary.totalResolved).toBe(0);
  });

  it("includes previousScan timestamp in summary", () => {
    const prev = makeScan();
    const curr = makeScan();
    const diff = diffScans(curr, prev);
    expect(diff.summary.previousScan).toBeDefined();
  });
});
