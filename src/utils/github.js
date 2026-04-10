import { Octokit } from "octokit";
import { withRetry } from "./retry.js";
import dotenv from "dotenv";
dotenv.config();

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// --- Rate Limit Tracking ---
let rateLimitInfo = { limit: 0, remaining: 0, used: 0, reset: 0, resetAt: null };

octokit.hook.after("request", async (response) => {
  const h = response.headers;
  if (h["x-ratelimit-limit"]) {
    rateLimitInfo = {
      limit: parseInt(h["x-ratelimit-limit"], 10),
      remaining: parseInt(h["x-ratelimit-remaining"], 10),
      used: parseInt(h["x-ratelimit-used"] || "0", 10),
      reset: parseInt(h["x-ratelimit-reset"], 10),
      resetAt: new Date(parseInt(h["x-ratelimit-reset"], 10) * 1000).toISOString(),
    };
  }
});

export function getRateLimitInfo() {
  return { ...rateLimitInfo };
}

export async function getAllRepos() {
  return withRetry(async () => {
    const repos = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
      sort: "updated",
      per_page: 100,
      affiliation: "owner,collaborator,organization_member",
    });

    const excluded = (process.env.EXCLUDE_REPOS || "")
      .split(",")
      .map((r) => r.trim().toLowerCase())
      .filter(Boolean);

    return repos.filter((r) => !r.archived && !excluded.includes(r.full_name.toLowerCase()));
  });
}

export { octokit };
