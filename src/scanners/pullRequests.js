import { octokit } from "../utils/github.js";
import { getMaxItems } from "../utils/scanRules.js";

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

export async function scanOpenPRs(repos) {
  const prs = [];
  const maxItems = getMaxItems();

  for (const repo of repos) {
    if (prs.length >= maxItems) break;

    try {
      const { data } = await octokit.rest.pulls.list({
        owner: repo.owner.login,
        repo: repo.name,
        state: "open",
        per_page: 20,
      });

      const prDetails = await mapConcurrent(data, async (pr) => {
        const [reviewRequests, reviews] = await Promise.all([
          octokit.rest.pulls.listRequestedReviewers({
            owner: repo.owner.login, repo: repo.name, pull_number: pr.number,
          }).catch(() => ({ data: { users: [] } })),
          octokit.rest.pulls.listReviews({
            owner: repo.owner.login, repo: repo.name, pull_number: pr.number,
          }).catch(() => ({ data: [] })),
        ]);

        const ageMs = Date.now() - new Date(pr.created_at).getTime();
        return {
          repo: repo.full_name,
          number: pr.number,
          title: pr.title,
          author: pr.user.login,
          url: pr.html_url,
          created: pr.created_at,
          ageDays: Math.floor(ageMs / (1000 * 60 * 60 * 24)),
          draft: pr.draft,
          reviewers: reviewRequests.data.users?.map((u) => u.login) || [],
          reviewCount: reviews.data.length,
          mergeable: pr.mergeable_state,
          labels: pr.labels.map((l) => l.name),
        };
      }, CONCURRENCY);

      prs.push(...prDetails);
    } catch (err) {
      if (err.status !== 403 && err.status !== 404) {
        console.warn(`Failed to scan PRs for ${repo.full_name}:`, err.message);
      }
    }
  }

  prs.sort((a, b) => b.ageDays - a.ageDays);

  return {
    category: "Open PRs Needing Review",
    emoji: "🔀",
    count: prs.length,
    items: prs.slice(0, maxItems),
    summary: prs.length
      ? prs.map((p) => `• **${p.repo}#${p.number}** — ${p.title} (by @${p.author}, ${p.ageDays}d old${p.draft ? ", draft" : ""}) ([link](${p.url}))`).join("\n")
      : "No open PRs 🎉",
  };
}
