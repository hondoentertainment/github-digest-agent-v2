import { octokit } from "../utils/github.js";
import dotenv from "dotenv";

dotenv.config();

/** @type {(opts: { prompt: string; maxTokens?: number; systemPrompt?: string }) => Promise<string>} */
let createCompletion;

try {
  const mod = await import("./aiProvider.js");
  createCompletion = mod.createCompletion;
} catch {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  createCompletion = async ({ prompt, maxTokens = 1000, systemPrompt = "" }) => {
    const msg = await client.messages.create({
      model: process.env.AI_MODEL || "claude-sonnet-4-20250514",
      max_tokens: maxTokens,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: "user", content: prompt }],
    });
    const first = msg.content?.[0];
    return first && first.type === "text" ? first.text : "";
  };
}

const JSON_SYSTEM = `You are a senior engineer. Respond with ONLY valid JSON (no markdown fence), exactly this shape:
{"summary":"string","steps":["string",...],"confidence":"high"|"medium"|"low","canAutoPR":boolean,"suggestedBranch":"string or null","fileChanges":[{"path":"relative/path/in/repo","content":"full file contents as UTF-8 string"}]}
Rules:
- summary: one-line fix description.
- steps: 3-8 concrete actionable steps.
- confidence: high if the fix path is standard; medium if some repo context is assumed; low if uncertain.
- canAutoPR: true only for issues and security items where a dependency bump or small config change could be automated; false for ambiguous code or policy. For builds, prefer false unless it is clearly a one-line config fix.
- suggestedBranch: a safe branch name like fix/ci-node-version or fix/dependabot-xyz, or null if unclear.
- fileChanges: optional. Include only when you can output complete file contents for 1–5 files (e.g. package.json version bump, small config YAML). Omit or use [] when unsure. Paths must be repo-relative, no ".." segments.`;

const CONFIDENCE = new Set(["high", "medium", "low"]);

/**
 * @param {string} category
 * @param {unknown} item
 */
function buildCategoryUserPrompt(category, item) {
  const payload = JSON.stringify({ category, item }, null, 2);
  const c = String(category || "").toLowerCase();

  if (c === "builds") {
    return `Category: builds (CI / workflows / tests / compilation failures).

Focus on: failing jobs, flaky tests, missing secrets in CI (name only, never echo secrets), dependency or Node/runtime mismatches, workflow YAML fixes, and how to verify the fix.

Scan item (JSON):
${payload}

Return the JSON object as specified.`;
  }

  if (c === "security") {
    return `Category: security (Dependabot, Code Scanning, secret exposure alerts, vulnerable dependencies).

Focus on: upgrading vulnerable packages, applying patches, enabling or fixing workflows, rotating credentials (high level only — do not invent secret values), and verification steps.

Scan item (JSON):
${payload}

Return the JSON object as specified.`;
  }

  if (c === "issues") {
    return `Category: issues (open bugs, stale tickets, labels, assignments).

Focus on: triage, reproduction steps, likely code areas, linking to related PRs if implied by the item, and closing or splitting work.

Scan item (JSON):
${payload}

Return the JSON object as specified.`;
  }

  return `Category: ${category}

Scan item (JSON):
${payload}

Return the JSON object as specified.`;
}

/**
 * @param {string} raw
 * @returns {Record<string, unknown>}
 */
function parseSuggestionJson(raw) {
  const trimmed = String(raw || "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI response did not contain a JSON object");
  }
  const jsonSlice = trimmed.slice(start, end + 1);
  return JSON.parse(jsonSlice);
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string} category
 */
function normalizeSuggestion(obj, category) {
  const summary =
    typeof obj.summary === "string" && obj.summary.trim()
      ? obj.summary.trim()
      : "Review and remediate this finding in the repository.";
  const steps = Array.isArray(obj.steps)
    ? obj.steps.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const confRaw = typeof obj.confidence === "string" ? obj.confidence.toLowerCase() : "";
  const confidence = CONFIDENCE.has(confRaw)
    ? /** @type {"high"|"medium"|"low"} */ (confRaw)
    : "medium";
  const canAutoPR = Boolean(obj.canAutoPR);
  let suggestedBranch = null;
  if (obj.suggestedBranch === null || obj.suggestedBranch === undefined) {
    suggestedBranch = null;
  } else if (typeof obj.suggestedBranch === "string" && obj.suggestedBranch.trim()) {
    suggestedBranch = obj.suggestedBranch.trim();
  }

  const c = String(category || "").toLowerCase();
  const defaultSteps =
    c === "builds"
      ? [
          "Open the failing workflow run or build log in GitHub Actions.",
          "Identify the first error line and the step that failed.",
          "Apply the minimal fix (config, dependency, or code) and push a branch.",
          "Re-run CI and confirm green.",
        ]
      : c === "security"
        ? [
            "Open the security alert or advisory in the GitHub UI.",
            "Apply the recommended upgrade or patch version.",
            "Run tests and security scans after the change.",
            "Deploy or merge following your team's change process.",
          ]
        : [
            "Reproduce or validate the issue description.",
            "Identify the component or file likely involved.",
            "Implement or document the fix and add tests if applicable.",
            "Open or update a PR and request review.",
          ];

  /** @type {{ path: string; content: string }[]} */
  let fileChanges = [];
  if (Array.isArray(obj.fileChanges)) {
    const max = 25;
    for (const entry of obj.fileChanges) {
      if (fileChanges.length >= max) break;
      if (!entry || typeof entry !== "object") continue;
      const path =
        typeof entry.path === "string"
          ? entry.path.trim().replace(/^\/+/, "").replace(/\\/g, "/")
          : "";
      const content = typeof entry.content === "string" ? entry.content : "";
      if (!path || path.includes("..") || path.length > 500 || content.length > 512000) continue;
      fileChanges.push({ path, content });
    }
  }

  return {
    summary,
    steps: steps.length ? steps : defaultSteps,
    confidence,
    canAutoPR,
    suggestedBranch,
    fileChanges,
  };
}

/**
 * @param {unknown} item
 * @param {string} category
 * @returns {boolean}
 */
export function canSuggestFix(item, category) {
  void item;
  const c = String(category || "").toLowerCase();
  return c === "builds" || c === "security" || c === "issues";
}

/**
 * @param {unknown} item
 * @param {string} category
 * @returns {Promise<{ summary: string; steps: string[]; confidence: "high"|"medium"|"low"; canAutoPR: boolean; suggestedBranch: string | null; fileChanges: { path: string; content: string }[] }>}
 */
export async function generateFixSuggestion(item, category) {
  if (!canSuggestFix(item, category)) {
    return {
      summary: "Automated fix suggestions are not enabled for this category.",
      steps: [
        "Review this item manually in GitHub.",
        "Decide on policy and ownership with your team.",
        "Track progress outside of automated fix hints.",
      ],
      confidence: "low",
      canAutoPR: false,
      suggestedBranch: null,
      fileChanges: [],
    };
  }

  try {
    const userPrompt = buildCategoryUserPrompt(category, item);
    const text = await createCompletion({
      systemPrompt: JSON_SYSTEM,
      prompt: userPrompt,
      maxTokens: 1500,
    });
    const parsed = parseSuggestionJson(text);
    return normalizeSuggestion(parsed, category);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`generateFixSuggestion failed: ${message}`);
  }
}

/**
 * @param {{ owner: string; repo: string; title: string; body: string; branch: string; baseBranch?: string; files?: { path: string; content: string }[] }} params
 * @returns {Promise<{ prUrl: string; prNumber: number; branch: string } | { error: true; message: string; status?: number }>}
 */
export async function createFixPR({ owner, repo, title, body, branch, baseBranch = "main", files }) {
  try {
    if (!owner?.trim() || !repo?.trim() || !title?.trim() || !branch?.trim()) {
      return {
        error: true,
        message: "owner, repo, title, and branch are required non-empty strings",
      };
    }

    const o = owner.trim();
    const r = repo.trim();
    const b = branch.trim();
    const base = baseBranch?.trim() || "main";

    const {
      data: {
        object: { sha: baseCommitSha },
      },
    } = await octokit.rest.git.getRef({
      owner: o,
      repo: r,
      ref: `heads/${base}`,
    });

    const patchFiles = Array.isArray(files)
      ? files.filter((f) => f && typeof f.path === "string" && typeof f.content === "string")
      : [];

    let headSha = baseCommitSha;

    if (patchFiles.length > 0) {
      const { data: baseCommit } = await octokit.rest.git.getCommit({
        owner: o,
        repo: r,
        commit_sha: baseCommitSha,
      });
      const baseTreeSha = baseCommit.tree.sha;

      const treeEntries = await Promise.all(
        patchFiles.map(async (f) => {
          const rel = String(f.path).trim().replace(/^\/+/, "");
          const content = typeof f.content === "string" ? f.content : "";
          const { data: blob } = await octokit.rest.git.createBlob({
            owner: o,
            repo: r,
            content: Buffer.from(content, "utf8").toString("base64"),
            encoding: "base64",
          });
          return {
            path: rel,
            mode: "100644",
            type: "blob",
            sha: blob.sha,
          };
        })
      );

      const { data: newTree } = await octokit.rest.git.createTree({
        owner: o,
        repo: r,
        base_tree: baseTreeSha,
        tree: treeEntries,
      });

      const { data: newCommit } = await octokit.rest.git.createCommit({
        owner: o,
        repo: r,
        message: title.trim().slice(0, 500) || "Apply automated fix",
        tree: newTree.sha,
        parents: [baseCommitSha],
      });
      headSha = newCommit.sha;
    }

    await octokit.rest.git.createRef({
      owner: o,
      repo: r,
      ref: `refs/heads/${b}`,
      sha: headSha,
    });

    const { data: pr } = await octokit.rest.pulls.create({
      owner: o,
      repo: r,
      title: title.trim(),
      body: typeof body === "string" ? body : "",
      head: b,
      base,
    });

    return {
      prUrl: pr.html_url,
      prNumber: pr.number,
      branch: b,
    };
  } catch (err) {
    const status = /** @type {{ status?: number }} */ (err).status;
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: true,
      message,
      ...(typeof status === "number" ? { status } : {}),
    };
  }
}
