import { createCompletion } from "./aiProvider.js";

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
    raw = await createCompletion({
      prompt: `You are a concise DevOps assistant analyzing a GitHub scan.

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
      maxTokens: 1500,
    });
    raw = raw.replace(/```json|```/g, "").trim();
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
