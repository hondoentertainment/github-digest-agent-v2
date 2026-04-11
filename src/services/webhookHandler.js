import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

/**
 * @param {string|Buffer} payload - Raw body string (or Buffer) GitHub signed
 * @param {string|undefined} signature - X-Hub-Signature-256 header value
 * @param {string} secret - WEBHOOK_SECRET
 * @returns {boolean}
 */
export function verifyWebhookSignature(payload, signature, secret) {
  try {
    if (!secret || typeof secret !== "string" || !signature || typeof signature !== "string") {
      return false;
    }
    const sig = signature.trim();
    const prefix = "sha256=";
    if (!sig.startsWith(prefix)) {
      return false;
    }
    const expected =
      prefix +
      crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(sig, "utf8");
    if (a.length !== b.length) {
      return false;
    }
    return crypto.timingSafeEqual(a, b);
  } catch (err) {
    console.error("verifyWebhookSignature error:", err);
    return false;
  }
}

/**
 * @returns {string|null}
 */
export function getWebhookSecret() {
  return process.env.WEBHOOK_SECRET || null;
}

function parseBody(body) {
  if (body == null) {
    return {};
  }
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (err) {
      console.error("parseWebhookEvent: invalid JSON body", err);
      return {};
    }
  }
  if (typeof body === "object") {
    return body;
  }
  return {};
}

function repoFullName(data) {
  const name = data.repository?.full_name;
  return typeof name === "string" ? name : null;
}

/**
 * @param {string|object} body
 * @param {string} eventType - X-GitHub-Event header
 * @returns {{ action: string|null, repo: string|null, trigger: string, shouldScan: boolean }}
 */
export function parseWebhookEvent(body, eventType) {
  try {
    const type = (eventType || "").toLowerCase();
    const data = parseBody(body);
    const action = data.action != null ? String(data.action) : null;
    const repo = repoFullName(data);

    const result = (shouldScan, trigger) => ({
      action,
      repo,
      trigger,
      shouldScan,
    });

    if (!type) {
      return result(false, "Missing GitHub event type");
    }

    switch (type) {
      case "push": {
        const ref = data.ref;
        const defaultBranch = data.repository?.default_branch;
        if (!ref || !defaultBranch) {
          return result(false, "Push event missing ref or default branch");
        }
        const expectedRef = `refs/heads/${defaultBranch}`;
        if (ref === expectedRef) {
          return result(true, `Push to default branch ${defaultBranch}`);
        }
        return result(false, `Push to non-default ref (${ref})`);
      }

      case "pull_request": {
        const prActions = new Set(["opened", "closed", "reopened"]);
        if (action && prActions.has(action)) {
          return result(true, `Pull request ${action}`);
        }
        return result(
          false,
          action ? `Pull request action not scanned (${action})` : "Pull request missing action"
        );
      }

      case "workflow_run": {
        const wr = data.workflow_run;
        const conclusion = wr?.conclusion;
        const status = wr?.status;
        if (status === "completed" && conclusion === "failure") {
          return result(true, "Workflow run completed with failure");
        }
        return result(
          false,
          `Workflow run not a failed completion (status=${status}, conclusion=${conclusion})`
        );
      }

      case "issues": {
        if (action === "opened") {
          return result(true, "Issue opened");
        }
        return result(false, action ? `Issues action not scanned (${action})` : "Issues missing action");
      }

      case "security_advisory": {
        return result(true, action ? `Security advisory: ${action}` : "Security advisory event");
      }

      case "create":
      case "delete": {
        const refType = data.ref_type != null ? String(data.ref_type) : "";
        if (refType === "branch") {
          return result(true, `${type === "create" ? "Branch created" : "Branch deleted"}: ${data.ref ?? "unknown ref"}`);
        }
        return result(false, `${type} event for ref_type=${refType || "unknown"} (branches only)`);
      }

      default:
        return result(false, `Event type not configured for scans (${type})`);
    }
  } catch (err) {
    console.error("parseWebhookEvent error:", err);
    return {
      action: null,
      repo: null,
      trigger: "Error parsing webhook event",
      shouldScan: false,
    };
  }
}
