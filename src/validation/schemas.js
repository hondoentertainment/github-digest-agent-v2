import { z } from "zod";

export const loginSchema = z.object({
  password: z.string().optional(),
  username: z.string().max(200).optional(),
});

export const scannersConfigSchema = z.object({
  scanners: z.array(z.string().max(64)).min(0).max(50),
});

export const rulesConfigSchema = z.object({
  rules: z.object({
    staleBranchDays: z.number().int().positive().max(3650).optional(),
    buildWindowHours: z.number().int().positive().max(8760).optional(),
    severityThreshold: z.enum(["low", "medium", "high", "critical"]).optional(),
    maxItemsPerScanner: z.number().int().positive().max(5000).optional(),
  }),
});

export const aiProviderSchema = z.object({
  provider: z.enum(["claude", "openai", "gemini"]),
});

export const suggestFixSchema = z.object({
  item: z.any(),
  category: z.string().min(1).max(32),
});

const prFileEntrySchema = z.object({
  path: z
    .string()
    .min(1)
    .max(500)
    .refine((p) => {
      const s = String(p);
      return !s.includes("..") && !s.startsWith("/") && !/^[a-zA-Z]:/.test(s) && !s.includes("\\");
    }, "invalid path"),
  content: z.string().max(512000),
});

export const createPrSchema = z.object({
  owner: z.string().min(1).max(200),
  repo: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  body: z.string().max(50000).optional(),
  branch: z.string().min(1).max(200),
  baseBranch: z.string().max(200).optional(),
  /** When non-empty, commits these files on the new branch before opening the PR */
  files: z.array(prFileEntrySchema).max(25).optional(),
});

export const createUserSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(500),
  role: z.enum(["admin", "viewer"]).optional(),
  email: z.string().email().max(320).nullable().optional(),
});

export const updateUserSchema = z.object({
  email: z.string().email().max(320).nullable().optional(),
  role: z.enum(["admin", "viewer"]).optional(),
  password: z.string().min(1).max(500).optional(),
  preferences: z.any().optional(),
});

export const integrationTicketSchema = z.object({
  system: z.enum(["linear", "jira"]),
  title: z.string().min(1).max(500),
  description: z.string().max(50000).optional(),
  teamId: z.string().max(100).optional(),
  issueType: z.string().max(100).optional(),
});

export const alertRulesSchema = z.object({
  securityCountGt: z.number().int().min(0).nullable().optional(),
  failedBuildsGt: z.number().int().min(0).nullable().optional(),
  pageOnCriticalSecurity: z.boolean().optional(),
  slackMention: z.string().max(500).optional(),
  totalItemsSpikeMultiplier: z.number().min(1.01).max(50).nullable().optional(),
  spikeLookback: z.number().int().min(2).max(50).optional(),
});

export const compareReposSchema = z.object({
  repos: z.array(z.string().min(1).max(260)).min(1).max(25),
});

export const userScheduleSchema = z.object({
  digestFrequency: z.enum(["off", "daily", "weekly"]),
  digestHourUtc: z.number().int().min(0).max(23).optional(),
});

/**
 * @param {z.ZodSchema} schema
 * @param {unknown} body
 * @returns {{ success: true, data: unknown } | { success: false, message: string }}
 */
export function safeParseBody(schema, body) {
  const r = schema.safeParse(body);
  if (!r.success) {
    const issues = r.error?.issues ?? r.error?.errors ?? [];
    const msg = (Array.isArray(issues) ? issues : [])
      .map((e) => `${(e.path ?? []).join(".")}: ${e.message}`)
      .join("; ");
    return { success: false, message: msg || "Validation failed" };
  }
  return { success: true, data: r.data };
}
