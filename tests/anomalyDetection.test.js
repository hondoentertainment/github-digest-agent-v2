import { describe, it, expect } from "vitest";
import { computeTotalItemsSpike, buildAnomalyReport } from "../src/utils/anomalyDetection.js";

describe("anomalyDetection", () => {
  it("does not trigger when multiplier unset", () => {
    const r = computeTotalItemsSpike({ meta: { totalItems: 999 } }, [{ totalItems: 5 }, { totalItems: 5 }], {});
    expect(r.triggered).toBe(false);
  });

  it("triggers when current exceeds baseline * multiplier", () => {
    const hist = Array.from({ length: 8 }, () => ({ totalItems: 10 }));
    const r = computeTotalItemsSpike({ meta: { totalItems: 50 } }, hist, {
      totalItemsSpikeMultiplier: 2,
      spikeLookback: 8,
    });
    expect(r.triggered).toBe(true);
    expect(r.reason).toContain("spike");
  });

  it("buildAnomalyReport includes spike evaluation shape", () => {
    const rep = buildAnomalyReport(null, null, { totalItemsSpikeMultiplier: null });
    expect(rep.spikeEvaluation).toHaveProperty("triggered");
    expect(rep.alerts).toBeInstanceOf(Array);
  });
});
