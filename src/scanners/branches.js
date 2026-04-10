import { octokit } from "../utils/github.js";
import { getStaleBranchDays, getMaxItems } from "../utils/scanRules.js";

const CONCURRENCY = 5;

async function mapConcurrent(items, fn, limit) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function scanStaleBranches(repos) {
  const staleDays = getStaleBranchDays();
  const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);
  const staleBranches = [];
  const maxItems = getMaxItems();

  for (const repo of repos) {
    if (staleBranches.length >= maxItems) break;

    try {
      const { data: branches } = await octokit.rest.repos.listBranches({
        owner: repo.owner.login,
        repo: repo.name,
        per_page: 100,
      });

      const nonDefault = branches.filter((b) => b.name !== repo.default_branch);

      const results = await mapConcurrent(nonDefault, async (branch) => {
        try {
          const { data: commit } = await octokit.rest.repos.getCommit({
            owner: repo.owner.login,
            repo: repo.name,
            ref: branch.commit.sha,
          });

          const lastCommitDate = new Date(commit.commit.committer?.date || commit.commit.author?.date);

          if (lastCommitDate < cutoff) {
            return {
              repo: repo.full_name,
              branch: branch.name,
              lastCommit: lastCommitDate.toISOString(),
              ageDays: Math.floor((Date.now() - lastCommitDate) / (1000 * 60 * 60 * 24)),
              author: commit.commit.author?.name || "unknown",
              url: `https://github.com/${repo.full_name}/tree/${encodeURIComponent(branch.name)}`,
              protected: branch.protected,
            };
          }
        } catch { /* skip individual branch errors */ }
        return null;
      }, CONCURRENCY);

      staleBranches.push(...results.filter(Boolean));
    } catch (err) {
      if (err.status !== 403 && err.status !== 404) {
        console.warn(`Failed to scan branches for ${repo.full_name}:`, err.message);
      }
    }
  }

  staleBranches.sort((a, b) => b.ageDays - a.ageDays);

  return {
    category: "Stale Branches",
    emoji: "🌿",
    count: staleBranches.length,
    items: staleBranches.slice(0, maxItems),
    summary: staleBranches.length
      ? staleBranches
          .slice(0, 15)
          .map((b) => `• **${b.repo}** — \`${b.branch}\` (${b.ageDays}d stale, last by ${b.author}${b.protected ? " ⚠️ protected" : ""}) ([link](${b.url}))`)
          .join("\n") + (staleBranches.length > 15 ? `\n• ...and ${staleBranches.length - 15} more` : "")
      : `No branches older than ${staleDays} days 🧹`,
  };
}
