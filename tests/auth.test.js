import { describe, it, expect, vi, beforeEach } from "vitest";

describe("authMiddleware", () => {
  let authMiddleware, isAuthEnabled;

  beforeEach(async () => {
    vi.resetModules();
  });

  it("passes through when DASHBOARD_PASSWORD is not set", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "");
    const mod = await import("../src/middleware/auth.js");
    authMiddleware = mod.authMiddleware;
    isAuthEnabled = mod.isAuthEnabled;

    expect(isAuthEnabled()).toBe(false);

    const next = vi.fn();
    const req = { headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("blocks requests without valid token when password is set", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "secret123");
    const mod = await import("../src/middleware/auth.js");

    const next = vi.fn();
    const req = { headers: {} };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    mod.authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("passes with valid x-api-key header", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "secret123");
    const mod = await import("../src/middleware/auth.js");

    const next = vi.fn();
    const req = { headers: { "x-api-key": "secret123" } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    mod.authMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("passes with valid Bearer token", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "secret123");
    const mod = await import("../src/middleware/auth.js");

    const next = vi.fn();
    const req = { headers: { authorization: "Bearer secret123" } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    mod.authMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects wrong token", async () => {
    vi.stubEnv("DASHBOARD_PASSWORD", "secret123");
    const mod = await import("../src/middleware/auth.js");

    const next = vi.fn();
    const req = { headers: { "x-api-key": "wrong" } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };

    mod.authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
