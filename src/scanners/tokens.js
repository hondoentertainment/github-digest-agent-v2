import { octokit } from "../utils/github.js";

export async function scanExpiredTokens(repos) {
  const issues = [];

  // Check if the current token is nearing expiration
  try {
    const { headers } = await octokit.rest.rateLimit.get();
    const tokenExpiration = headers["github-authentication-token-expiration"];
    if (tokenExpiration) {
      const expDate = new Date(tokenExpiration);
      const daysUntilExp = Math.floor((expDate - Date.now()) / (1000 * 60 * 60 * 24));
      if (daysUntilExp <= 7) {
        issues.push({
          repo: "ACCOUNT-LEVEL",
          type: "pat-expiration",
          title: `Personal access token expires in ${daysUntilExp} days (${expDate.toLocaleDateString()})`,
          severity: daysUntilExp <= 1 ? "critical" : "warning",
          url: "https://github.com/settings/tokens",
        });
      }
    }
  } catch (err) {
    // non-critical
  }

  // Check deploy keys per repo
  for (const repo of repos) {
    try {
      const { data: keys } = await octokit.rest.repos.listDeployKeys({
        owner: repo.owner.login,
        repo: repo.name,
      });

      for (const key of keys) {
        if (key.expired || (key.expires_at && new Date(key.expires_at) < Date.now())) {
          issues.push({
            repo: repo.full_name,
            type: "deploy-key",
            title: `Deploy key "${key.title}" is expired`,
            severity: "warning",
            url: `https://github.com/${repo.full_name}/settings/keys`,
          });
        }
      }
    } catch (err) {
      // Skip
    }

    // Check for secrets in recent commits (basic heuristic via secret scanning)
    // Already covered in security scanner, but flag repo-level webhook failures
    try {
      const { data: hooks } = await octokit.rest.repos.listWebhooks({
        owner: repo.owner.login,
        repo: repo.name,
      });

      for (const hook of hooks) {
        if (hook.last_response?.code && hook.last_response.code >= 400) {
          issues.push({
            repo: repo.full_name,
            type: "webhook-failure",
            title: `Webhook "${hook.config?.url || hook.id}" returning ${hook.last_response.code}`,
            severity: "warning",
            url: `https://github.com/${repo.full_name}/settings/hooks/${hook.id}`,
          });
        }
      }
    } catch (err) {
      // Skip — may not have admin access
    }
  }

  return {
    category: "Expired Tokens & Credentials",
    emoji: "🔑",
    count: issues.length,
    items: issues,
    summary: issues.length
      ? issues
          .map((i) => `• **${i.repo}** [${i.severity.toUpperCase()}] ${i.title} ([link](${i.url}))`)
          .join("\n")
      : "All tokens and credentials look good 🔐",
  };
}
