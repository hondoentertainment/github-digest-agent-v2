import { vi, describe, it, expect, beforeEach } from "vitest";

const { mockCompletion, mockSendMail } = vi.hoisted(() => ({
  mockCompletion: vi.fn(),
  mockSendMail: vi.fn(),
}));

vi.mock("../src/services/aiProvider.js", () => ({
  createCompletion: mockCompletion,
  getProviderName: vi.fn(() => "claude"),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn(() => ({ sendMail: mockSendMail })),
  },
}));

import { generateDigest } from "../src/services/summarizer.js";
import { generateDashboardSummary } from "../src/services/dashboardSummary.js";
import { sendDigestEmail } from "../src/services/mailer.js";

// ── Summarizer ───────────────────────────────────────────────────

describe("generateDigest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns full HTML email with AI response", async () => {
    mockCompletion.mockResolvedValue("<div>AI-generated summary here</div>");

    const scanResults = [
      { category: "Builds", emoji: "🔴", count: 1, summary: "1 failure", items: [] },
      { category: "PRs", emoji: "🔀", count: 0, summary: "No open PRs", items: [] },
    ];

    const result = await generateDigest(scanResults, 5);
    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain("GitHub Daily Digest");
    expect(result).toContain("AI-generated summary here");
    expect(mockCompletion).toHaveBeenCalledOnce();
  });

  it("includes repo count and date in the email", async () => {
    mockCompletion.mockResolvedValue("<p>Summary</p>");

    const result = await generateDigest(
      [{ category: "Test", emoji: "✅", count: 0, summary: "OK", items: [] }],
      12
    );
    expect(result).toContain("12 repos scanned");
  });

  it("returns fallback HTML when AI fails", async () => {
    mockCompletion.mockRejectedValue(new Error("API rate limit exceeded"));

    const scanResults = [
      { category: "Builds", emoji: "🔴", count: 1, summary: "1 failure", items: [] },
    ];

    const result = await generateDigest(scanResults, 5);
    expect(result).toContain("<!DOCTYPE html>");
    expect(result).toContain("Builds");
    expect(result).toContain("1 failure");
  });
});

// ── Dashboard Summary ────────────────────────────────────────────

describe("generateDashboardSummary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns parsed JSON summary from AI", async () => {
    const summary = {
      topOfMind: "Fix failing builds immediately",
      actions: ["Review CI pipeline", "Update dependencies"],
      categoryInsights: { builds: "One build failing on main" },
    };
    mockCompletion.mockResolvedValue(JSON.stringify(summary));

    const scanData = {
      meta: { reposScanned: 5 },
      builds: { emoji: "🔴", category: "Builds", count: 1, summary: "1 failure" },
      prs: { emoji: "🔀", category: "PRs", count: 0, summary: "None" },
      security: { emoji: "🛡️", category: "Security", count: 0, summary: "None" },
      tokens: { emoji: "🔑", category: "Tokens", count: 0, summary: "None" },
      issues: { emoji: "🐛", category: "Issues", count: 0, summary: "None" },
      branches: { emoji: "🌿", category: "Branches", count: 0, summary: "None" },
    };

    const result = await generateDashboardSummary(scanData);
    expect(result.topOfMind).toBe("Fix failing builds immediately");
    expect(result.actions).toHaveLength(2);
    expect(result.categoryInsights.builds).toBeDefined();
  });

  it("handles malformed JSON from AI", async () => {
    mockCompletion.mockResolvedValue("This is not valid JSON");

    const scanData = {
      meta: { reposScanned: 3 },
      builds: { emoji: "🔴", category: "Builds", count: 0, summary: "OK" },
    };

    const result = await generateDashboardSummary(scanData);
    expect(result.topOfMind).toBeDefined();
    expect(result.actions).toBeDefined();
  });

  it("returns fallback when AI fails", async () => {
    mockCompletion.mockRejectedValue(new Error("Connection refused"));

    const scanData = {
      meta: { reposScanned: 5 },
      builds: { emoji: "🔴", category: "Builds", count: 0, summary: "None" },
    };

    const result = await generateDashboardSummary(scanData);
    expect(result.topOfMind).toContain("unavailable");
    expect(result.actions).toBeInstanceOf(Array);
    expect(result.categoryInsights).toBeDefined();
  });
});

// ── Mailer ───────────────────────────────────────────────────────

describe("sendDigestEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SMTP_HOST = "smtp.test.com";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_USER = "test@test.com";
    process.env.SMTP_PASS = "testpass";
    process.env.EMAIL_TO = "recipient@test.com";
    mockSendMail.mockResolvedValue({ messageId: "<test-123@test.com>" });
  });

  it("sends email and returns message info", async () => {
    const result = await sendDigestEmail("<div>Test digest</div>");
    expect(result.messageId).toBe("<test-123@test.com>");
    expect(mockSendMail).toHaveBeenCalledOnce();
  });

  it("includes date in subject line", async () => {
    await sendDigestEmail("<div>Content</div>");
    const callArgs = mockSendMail.mock.calls[0][0];
    expect(callArgs.subject).toContain("GitHub Digest");
    expect(callArgs.html).toContain("Content");
  });
});
