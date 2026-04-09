import { octokit } from "../utils/github.js";

export async function scanSecurityAlerts(repos) {
  const alerts = [];

  for (const repo of repos) {
    // Dependabot alerts
    try {
      const { data } = await octokit.rest.dependabot.listAlertsForRepo({
        owner: repo.owner.login,
        repo: repo.name,
        state: "open",
        per_page: 20,
      });

      for (const alert of data) {
        alerts.push({
          repo: repo.full_name,
          type: "dependabot",
          severity: alert.security_advisory?.severity || "unknown",
          package: alert.security_vulnerability?.package?.name || "unknown",
          title: alert.security_advisory?.summary || "Vulnerability detected",
          url: alert.html_url,
          created: alert.created_at,
        });
      }
    } catch (err) {
      // Dependabot may not be enabled or accessible
    }

    // Code scanning alerts (if enabled)
    try {
      const { data } = await octokit.rest.codeScanning.listAlertsForRepo({
        owner: repo.owner.login,
        repo: repo.name,
        state: "open",
        per_page: 10,
      });

      for (const alert of data) {
        alerts.push({
          repo: repo.full_name,
          type: "code-scanning",
          severity: alert.rule?.severity || "unknown",
          package: alert.rule?.id || "",
          title: alert.rule?.description || "Code scanning alert",
          url: alert.html_url,
          created: alert.created_at,
        });
      }
    } catch (err) {
      // Code scanning may not be enabled
    }

    // Secret scanning alerts
    try {
      const { data } = await octokit.rest.secretScanning.listAlertsForRepo({
        owner: repo.owner.login,
        repo: repo.name,
        state: "open",
        per_page: 10,
      });

      for (const alert of data) {
        alerts.push({
          repo: repo.full_name,
          type: "secret-scanning",
          severity: "critical",
          package: alert.secret_type_display_name || alert.secret_type,
          title: `Exposed ${alert.secret_type_display_name || alert.secret_type}`,
          url: alert.html_url,
          created: alert.created_at,
        });
      }
    } catch (err) {
      // Secret scanning may not be enabled
    }
  }

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };
  alerts.sort((a, b) => (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4));

  return {
    category: "Security Alerts & Dependabot",
    emoji: "🛡️",
    count: alerts.length,
    items: alerts,
    summary: alerts.length
      ? alerts
          .map(
            (a) =>
              `• **${a.repo}** [${a.severity.toUpperCase()}] ${a.title} (${a.package}, ${a.type}) ([link](${a.url}))`
          )
          .join("\n")
      : "No security alerts 🔒",
  };
}
