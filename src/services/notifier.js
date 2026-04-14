import dotenv from "dotenv";
import { evaluateAlertRules } from "../utils/alertRules.js";
import { triggerPagerDuty } from "./integrations.js";

dotenv.config();

const SLACK_URL = process.env.SLACK_WEBHOOK_URL;
const DISCORD_URL = process.env.DISCORD_WEBHOOK_URL;

export function isSlackConfigured() {
  return !!SLACK_URL;
}

export function isDiscordConfigured() {
  return !!DISCORD_URL;
}

export function getNotificationChannels() {
  return {
    slack: isSlackConfigured(),
    discord: isDiscordConfigured(),
  };
}

export async function sendNotifications(scanResult) {
  const results = { slack: null, discord: null };

  if (isSlackConfigured()) {
    try {
      await sendSlack(scanResult);
      results.slack = "sent";
    } catch (err) {
      console.error("Slack notification failed:", err.message);
      results.slack = "failed";
    }
  }

  if (isDiscordConfigured()) {
    try {
      await sendDiscord(scanResult);
      results.discord = "sent";
    } catch (err) {
      console.error("Discord notification failed:", err.message);
      results.discord = "failed";
    }
  }

  try {
    const { triggered, reasons } = evaluateAlertRules(scanResult);
    if (triggered && process.env.PAGERDUTY_ROUTING_KEY?.trim()) {
      const sev = reasons.some((r) => r.includes("critical")) ? "critical" : "warning";
      await triggerPagerDuty({
        summary: `GitHub Digest: ${reasons.join("; ")}`,
        source: "github-digest-agent",
        severity: sev,
      });
    }
  } catch (err) {
    console.error("PagerDuty trigger failed:", err.message);
  }

  return results;
}

async function sendSlack(scan) {
  const { meta, builds, prs, security, tokens, issues, branches } = scan;
  const lines = [
    `*📊 GitHub Digest* — ${new Date(meta.lastRun).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`,
    `${meta.reposScanned} repos scanned · ${meta.totalItems} items found (${meta.elapsed})`,
    "",
    security.count > 0 ? `🛡️ *${security.count}* security alerts` : null,
    builds.count > 0 ? `🔴 *${builds.count}* failed builds` : null,
    tokens.count > 0 ? `🔑 *${tokens.count}* token issues` : null,
    prs.count > 0 ? `🔀 *${prs.count}* open PRs` : null,
    issues.count > 0 ? `🐛 *${issues.count}* open issues` : null,
    branches.count > 0 ? `🌿 *${branches.count}* stale branches` : null,
  ].filter(Boolean);

  if (meta.totalItems === 0) lines.push("✅ Everything looks good!");

  const res = await fetch(SLACK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: lines.join("\n") }),
  });

  if (!res.ok) throw new Error(`Slack returned ${res.status}`);
}

async function sendDiscord(scan) {
  const { meta, builds, prs, security, tokens, issues, branches } = scan;
  const fields = [
    security.count > 0 ? { name: "🛡️ Security", value: `${security.count} alerts`, inline: true } : null,
    builds.count > 0 ? { name: "🔴 Builds", value: `${builds.count} failures`, inline: true } : null,
    tokens.count > 0 ? { name: "🔑 Tokens", value: `${tokens.count} issues`, inline: true } : null,
    prs.count > 0 ? { name: "🔀 PRs", value: `${prs.count} open`, inline: true } : null,
    issues.count > 0 ? { name: "🐛 Issues", value: `${issues.count} open`, inline: true } : null,
    branches.count > 0 ? { name: "🌿 Branches", value: `${branches.count} stale`, inline: true } : null,
  ].filter(Boolean);

  const embed = {
    title: "📊 GitHub Digest",
    description: `${meta.reposScanned} repos scanned · ${meta.totalItems} items (${meta.elapsed})`,
    color: meta.totalItems > 0 ? 0xff5a52 : 0x30a14e,
    fields: fields.length > 0 ? fields : [{ name: "Status", value: "✅ Everything looks good!" }],
    timestamp: meta.lastRun,
  };

  const res = await fetch(DISCORD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!res.ok) throw new Error(`Discord returned ${res.status}`);
}
