import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { verifyWebhookSignature, parseWebhookEvent } from "../src/services/webhookHandler.js";

describe("webhookHandler", () => {
  const secret = "my-webhook-secret";

  it("verifies GitHub-style HMAC over raw Buffer body", () => {
    const payload = Buffer.from(JSON.stringify({ action: "opened", repository: { full_name: "o/r" } }), "utf8");
    const sig =
      "sha256=" +
      crypto.createHmac("sha256", secret).update(payload).digest("hex");
    expect(verifyWebhookSignature(payload, sig, secret)).toBe(true);
    expect(verifyWebhookSignature(payload, "sha256=deadbeef", secret)).toBe(false);
  });

  it("parses JSON from Buffer body for workflow_run", () => {
    const body = Buffer.from(
      JSON.stringify({
        action: "completed",
        repository: { full_name: "acme/app", default_branch: "main" },
        workflow_run: { status: "completed", conclusion: "failure" },
      }),
      "utf8"
    );
    const parsed = parseWebhookEvent(body, "workflow_run");
    expect(parsed.shouldScan).toBe(true);
    expect(parsed.repo).toBe("acme/app");
  });
});
