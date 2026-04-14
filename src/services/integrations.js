import dotenv from "dotenv";

dotenv.config();

/**
 * Create a Linear issue from a digest item (GraphQL API).
 * @param {{ title: string, description: string, teamId?: string }} payload
 */
export async function createLinearIssue(payload) {
  const key = process.env.LINEAR_API_KEY?.trim();
  if (!key) {
    return { error: true, message: "LINEAR_API_KEY not configured" };
  }

  const teamId = payload.teamId || process.env.LINEAR_TEAM_ID?.trim();
  if (!teamId) {
    return { error: true, message: "LINEAR_TEAM_ID or teamId required" };
  }

  const query = `
    mutation Create($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { id url identifier } }
    }
  `;

  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      variables: {
        input: {
          teamId,
          title: String(payload.title).slice(0, 500),
          description: String(payload.description || "").slice(0, 50000),
        },
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.errors?.length) {
    const msg = data.errors?.[0]?.message || res.statusText || `HTTP ${res.status}`;
    return { error: true, message: msg };
  }

  const issue = data.data?.issueCreate?.issue;
  return { error: false, id: issue?.id, url: issue?.url, identifier: issue?.identifier };
}

/**
 * Create a Jira issue (REST v3).
 * @param {{ summary: string, description: string, issueType?: string }} payload
 */
export async function createJiraIssue(payload) {
  const base = process.env.JIRA_BASE_URL?.trim()?.replace(/\/$/, "");
  const email = process.env.JIRA_EMAIL?.trim();
  const token = process.env.JIRA_API_TOKEN?.trim();
  const project = process.env.JIRA_PROJECT_KEY?.trim();

  if (!base || !email || !token || !project) {
    return { error: true, message: "JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEY required" };
  }

  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const body = {
    fields: {
      project: { key: project },
      summary: String(payload.summary).slice(0, 255),
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: String(payload.description || "").slice(0, 30000) }],
          },
        ],
      },
      issuetype: { name: payload.issueType || "Task" },
    },
  };

  const res = await fetch(`${base}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.errorMessages?.[0] || data.errors?.[0]?.message || res.statusText;
    return { error: true, message: msg || `HTTP ${res.status}` };
  }

  const key = data.key;
  const self = data.self;
  return { error: false, key, self };
}

/**
 * Trigger PagerDuty Events API v2.
 * @param {{ summary: string, source: string, severity: "critical"|"error"|"warning"|"info" }} payload
 */
export async function triggerPagerDuty(payload) {
  const routingKey = process.env.PAGERDUTY_ROUTING_KEY?.trim();
  if (!routingKey) {
    return { error: true, message: "PAGERDUTY_ROUTING_KEY not configured" };
  }

  const res = await fetch("https://events.pagerduty.com/v2/enqueue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      routing_key: routingKey,
      event_action: "trigger",
      payload: {
        summary: String(payload.summary).slice(0, 1024),
        source: payload.source || "github-digest-agent",
        severity: payload.severity || "warning",
      },
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { error: true, message: data.message || res.statusText };
  }
  return { error: false, dedupKey: data.dedup_key };
}
