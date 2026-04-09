import { octokit } from "../utils/github.js";

export async function scanFailedBuilds(repos) {
  const failures = [];

  for (const repo of repos) {
    try {
      // Check GitHub Actions workflow runs from the last 24 hours
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const { data } = await octokit.rest.actions.listWorkflowRunsForRepo({
        owner: repo.owner.login,
        repo: repo.name,
        status: "failure",
        created: `>=${since}`,
        per_page: 10,
      });

      for (const run of data.workflow_runs) {
        failures.push({
          repo: repo.full_name,
          workflow: run.name,
          branch: run.head_branch,
          message: run.head_commit?.message?.split("\n")[0] || "No commit message",
          url: run.html_url,
          created: run.created_at,
          conclusion: run.conclusion,
        });
      }
    } catch (err) {
      // Skip repos where we can't access Actions (permissions, etc.)
      if (err.status !== 403 && err.status !== 404) {
        console.warn(`Failed to scan builds for ${repo.full_name}:`, err.message);
      }
    }
  }

  return {
    category: "Failed CI/Build Issues",
    emoji: "🔴",
    count: failures.length,
    items: failures,
    summary: failures.length
      ? failures.map((f) => `• **${f.repo}** — \`${f.workflow}\` failed on \`${f.branch}\`: ${f.message} ([link](${f.url}))`).join("\n")
      : "All builds passing ✅",
  };
}
