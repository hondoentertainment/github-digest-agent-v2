import { describe, it, expect, vi, beforeEach } from "vitest";

describe("scanLock", () => {
  let withScanLock, isScanLocked, getScanError;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import("../src/utils/scanLock.js");
    withScanLock = mod.withScanLock;
    isScanLocked = mod.isScanLocked;
    getScanError = mod.getScanError;
  });

  it("starts unlocked", () => {
    expect(isScanLocked()).toBe(false);
    expect(getScanError()).toBeNull();
  });

  it("executes function and returns result", async () => {
    const result = await withScanLock(async () => "done");
    expect(result).toBe("done");
    expect(isScanLocked()).toBe(false);
  });

  it("rejects concurrent calls with 409", async () => {
    let resolve;
    const slowFn = () => new Promise((r) => { resolve = r; });

    const first = withScanLock(slowFn);

    expect(isScanLocked()).toBe(true);

    await expect(withScanLock(async () => {})).rejects.toThrow("already in progress");

    resolve("done");
    await first;
    expect(isScanLocked()).toBe(false);
  });

  it("tracks errors and unlocks after failure", async () => {
    await expect(
      withScanLock(async () => { throw new Error("scan broke"); })
    ).rejects.toThrow("scan broke");

    expect(isScanLocked()).toBe(false);
    expect(getScanError()).toBe("scan broke");
  });
});
