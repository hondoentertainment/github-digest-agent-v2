import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/utils/retry.js";

describe("withRetry", () => {
  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries on server error then succeeds", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce({ status: 500, message: "server error" })
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 10, maxDelay: 20 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 4xx client errors", async () => {
    const err = { status: 404, message: "not found" };
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { maxRetries: 3, baseDelay: 10 })).rejects.toEqual(err);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries on 429 rate limit", async () => {
    const rateLimitErr = {
      status: 429,
      message: "rate limited",
      response: { headers: { "retry-after": "0" } },
    };
    const fn = vi.fn()
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { maxRetries: 3, baseDelay: 10 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    const err = { status: 500, message: "keep failing" };
    const fn = vi.fn().mockRejectedValue(err);

    await expect(withRetry(fn, { maxRetries: 2, baseDelay: 10, maxDelay: 20 })).rejects.toEqual(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
