import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";
dotenv.config();

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Generate a structured JSON summary for the web dashboard.
 * Returns { topOfMind, actions[], categoryInsights{} }
 */
export async function generateDashboardSummary(scanData) {
  const categories = ["builds", "prs", "security", "tokens", "issues", "branches"];
  const scanText = categories
    .map((key) => {
      const cat = scanData[key];
      if (!cat) return "";
      return `## ${cat.emoji} ${cat.category} (${cat.count})\n${cat.summary}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const totalItems = categories.reduce((sum, key) => sum + (scanData[key]?.count || 0), 0);

  let raw;
  try {
    const message = await client.messages.create({
      model: process.env.AI_MODEL || "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content: `You are a concise DevOps assistant analyzing a GitHub scan.

Repos scanned: ${scanData.meta?.reposScanned || 0}
Total items: ${totalItems}

${scanText}

Respond ONLY with a JSON object (no markdown, no backticks):
{
  "topOfMind": "One sentence — the single most important thing to address right now and why",
  "actions": [
    "First recommended action (specific, actionable)",
    "Second recommended action",
    "Third recommended action"
  ],
  "categoryInsights": {
    "builds": "One sentence insight or null if no items",
    "prs": "One sentence insight or null",
    "security": "One sentence insight or null",
    "tokens": "One sentence insight or null",
    "issues": "One sentence insight or null",
    "branches": "One sentence insight or null"
  }
}`,
        },
      ],
    });
    raw = message.content[0].text.replace(/```json|```/g, "").trim();
  } catch (err) {
    console.error("Dashboard summary generation failed:", err.message);
    return {
      topOfMind: "AI summary unavailable — review scan results directly.",
      actions: ["Review the scan results below for details"],
      categoryInsights: {},
    };
  }

  try {
    return JSON.parse(raw);
  } catch {
    return {
      topOfMind: "Unable to parse AI summary — review the scan results below.",
      actions: [],
      categoryInsights: {},
    };
  }
}
