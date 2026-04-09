import { octokit } from "../utils/github.js";

export async function scanStaleBranches(repos) {
  const staleDays = parseInt(process.env.STALE_BRANCH_DAYS || "30", 10);
  const cutoff = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000);
  const staleBranches = [];

  for (const repo of repos) {
    try {
      const { data: branches } = await octokit.rest.repos.listBranches({
        owner: repo.owner.login,
        repo: repo.name,
        per_page: 100,
      });

      for (const branch of branches) {
        // Skip default branch
        if (branch.name === repo.default_branch) continue;

        try {
          const { data: commit } = await octokit.rest.repos.getCommit({
            owner: repo.owner.login,
            repo: repo.name,
            ref: branch.commit.sha,
          });

          const lastCommitDate = new Date(
            commit.commit.committer?.date || commit.commit.author?.date
          );

          if (lastCommitDate < cutoff) {
            const ageDays = Math.floor((Date.now() - lastCommitDate) / (1000 * 60 * 60 * 24));

            staleBranches.push({
              repo: repo.full_name,
              branch: branch.name,
              lastCommit: lastCommitDate.toISOString(),
              ageDays,
              author: commit.commit.author?.name || "unknown",
              url: `https://github.com/${repo.full_name}/tree/${encodeURIComponent(branch.name)}`,
              protected: branch.protected,
            });
          }
        } catch (err) {
          // Skip individual branch errors
        }
      }
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
    items: staleBranches,
    summary: staleBranches.length
      ? staleBranches
          .slice(0, 15)
          .map(
            (b) =>
              `• **${b.repo}** — \`${b.branch}\` (${b.ageDays}d stale, last by ${b.author}${b.protected ? " ⚠️ protected" : ""}) ([link](${b.url}))`
          )
          .join("\n") +
        (staleBranches.length > 15 ? `\n• ...and ${staleBranches.length - 15} more` : "")
      : `No branches older than ${staleDays} days 🧹`,
  };
}
