import { describe, it, expect } from "vitest";
import { computeEngineeringMetrics } from "../src/utils/engineeringMetrics.js";

describe("computeEngineeringMetrics", () => {
  it("returns zeros for empty scan", () => {
    const m = computeEngineeringMetrics(null);
    expect(m.openPRCount).toBe(0);
    expect(m.prAgeDaysP50).toBe(0);
  });

  it("computes PR age percentiles from items", () => {
    const scan = {
      prs: {
        items: [
          { ageDays: 1 },
          { ageDays: 2 },
          { ageDays: 3 },
          { ageDays: 10 },
        ],
        count: 4,
      },
      builds: { count: 2 },
      security: { count: 1 },
      branches: { count: 5 },
    };
    const m = computeEngineeringMetrics(scan);
    expect(m.openPRCount).toBe(4);
    expect(m.failedBuildCount).toBe(2);
    expect(m.securityAlertCount).toBe(1);
    expect(m.staleBranchCount).toBe(5);
    expect(m.prAgeDaysP50).toBeGreaterThan(0);
  });
});
