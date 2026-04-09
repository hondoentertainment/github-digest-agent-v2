import { octokit } from "../utils/github.js";

export async function scanOpenPRs(repos) {
  const prs = [];

  for (const repo of repos) {
    try {
      const { data } = await octokit.rest.pulls.list({
        owner: repo.owner.login,
        repo: repo.name,
        state: "open",
        per_page: 20,
      });

      for (const pr of data) {
        const reviewRequests = await octokit.rest.pulls.listRequestedReviewers({
          owner: repo.owner.login,
          repo: repo.name,
          pull_number: pr.number,
        });

        const reviews = await octokit.rest.pulls.listReviews({
          owner: repo.owner.login,
          repo: repo.name,
          pull_number: pr.number,
        });

        const ageMs = Date.now() - new Date(pr.created_at).getTime();
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));

        prs.push({
          repo: repo.full_name,
          number: pr.number,
          title: pr.title,
          author: pr.user.login,
          url: pr.html_url,
          created: pr.created_at,
          ageDays,
          draft: pr.draft,
          reviewers: reviewRequests.data.users?.map((u) => u.login) || [],
          reviewCount: reviews.data.length,
          mergeable: pr.mergeable_state,
          labels: pr.labels.map((l) => l.name),
        });
      }
    } catch (err) {
      if (err.status !== 403 && err.status !== 404) {
        console.warn(`Failed to scan PRs for ${repo.full_name}:`, err.message);
      }
    }
  }

  // Sort: oldest first (most urgent)
  prs.sort((a, b) => b.ageDays - a.ageDays);

  return {
    category: "Open PRs Needing Review",
    emoji: "🔀",
    count: prs.length,
    items: prs,
    summary: prs.length
      ? prs
          .map(
            (p) =>
              `• **${p.repo}#${p.number}** — ${p.title} (by @${p.author}, ${p.ageDays}d old${p.draft ? ", draft" : ""}) ([link](${p.url}))`
          )
          .join("\n")
      : "No open PRs 🎉",
  };
}
