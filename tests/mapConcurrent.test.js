import { describe, it, expect } from "vitest";
import { mapConcurrent } from "../src/utils/mapConcurrent.js";

describe("mapConcurrent", () => {
  it("returns empty array for empty input", async () => {
    const out = await mapConcurrent([], async (x) => x, 3);
    expect(out).toEqual([]);
  });

  it("maps all items with concurrency cap", async () => {
    const items = [1, 2, 3, 4, 5];
    const out = await mapConcurrent(
      items,
      async (n) => n * 2,
      2
    );
    expect(out).toEqual([2, 4, 6, 8, 10]);
  });
});
