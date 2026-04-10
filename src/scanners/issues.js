import { octokit } from "../utils/github.js";
import { getMaxItems } from "../utils/scanRules.js";

export async function scanOpenIssues(repos) {
  const issues = [];
  const maxItems = getMaxItems();

  for (const repo of repos) {
    if (issues.length >= maxItems) break;

    try {
      const { data } = await octokit.rest.issues.listForRepo({
        owner: repo.owner.login,
        repo: repo.name,
        state: "open",
        per_page: 20,
        sort: "updated",
        direction: "desc",
      });

      const realIssues = data.filter((i) => !i.pull_request);

      for (const issue of realIssues) {
        const ageMs = Date.now() - new Date(issue.created_at).getTime();
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        const labels = issue.labels.map((l) => (typeof l === "string" ? l : l.name));
        const isBug = labels.some((l) =>
          ["bug", "defect", "error", "p0", "p1", "critical", "urgent"].includes(l.toLowerCase())
        );

        issues.push({
          repo: repo.full_name,
          number: issue.number,
          title: issue.title,
          author: issue.user.login,
          url: issue.html_url,
          created: issue.created_at,
          ageDays,
          labels,
          isBug,
          assignees: issue.assignees.map((a) => a.login),
          commentCount: issue.comments,
        });
      }
    } catch (err) {
      if (err.status !== 403 && err.status !== 404) {
        console.warn(`Failed to scan issues for ${repo.full_name}:`, err.message);
      }
    }
  }

  issues.sort((a, b) => {
    if (a.isBug !== b.isBug) return b.isBug - a.isBug;
    return b.ageDays - a.ageDays;
  });

  return {
    category: "Open Issues & Bugs",
    emoji: "🐛",
    count: issues.length,
    items: issues.slice(0, maxItems),
    summary: issues.length
      ? issues
          .slice(0, 15)
          .map((i) => `• **${i.repo}#${i.number}** — ${i.title}${i.isBug ? " 🐛" : ""} (${i.ageDays}d old, ${i.commentCount} comments) ([link](${i.url}))`)
          .join("\n") + (issues.length > 15 ? `\n• ...and ${issues.length - 15} more` : "")
      : "No open issues 🎉",
  };
}
