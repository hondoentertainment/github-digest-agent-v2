import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config();

const PROVIDERS = ["claude", "openai", "gemini"];

const DEFAULT_MODELS = {
  claude: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash",
};

/** @type {string} */
let runtimeProvider = normalizeProviderId(process.env.AI_PROVIDER) || "claude";

function normalizeProviderId(name) {
  if (!name || typeof name !== "string") {
    return null;
  }
  const n = name.trim().toLowerCase();
  return PROVIDERS.includes(n) ? n : null;
}

function effectiveProvider() {
  return normalizeProviderId(runtimeProvider) || "claude";
}

function modelFor(provider) {
  const fromEnv = process.env.AI_MODEL?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return DEFAULT_MODELS[provider] ?? DEFAULT_MODELS.claude;
}

function requireKey(provider, envName, value) {
  if (!value || typeof value !== "string" || !value.trim()) {
    throw new Error(
      `AI provider "${provider}" requires ${envName} to be set to a non-empty API key`
    );
  }
  return value.trim();
}

function extractClaudeText(message) {
  if (!message?.content?.length) {
    return "";
  }
  return message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * @returns {"claude"|"openai"|"gemini"}
 */
export function getProviderName() {
  return effectiveProvider();
}

/**
 * @returns {{ id: string, name: string, configured: boolean }[]}
 */
export function getAvailableProviders() {
  return [
    {
      id: "claude",
      name: "Claude",
      configured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    },
    {
      id: "openai",
      name: "OpenAI",
      configured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    },
    {
      id: "gemini",
      name: "Gemini",
      configured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    },
  ];
}

/**
 * @param {string} providerId
 */
export function setProvider(providerId) {
  const normalized = normalizeProviderId(providerId);
  if (!normalized) {
    throw new Error(
      `Invalid AI provider "${providerId}". Expected one of: ${PROVIDERS.join(", ")}`
    );
  }
  runtimeProvider = normalized;
}

let anthropicClient = null;

function getAnthropicClient() {
  const key = requireKey("claude", "ANTHROPIC_API_KEY", process.env.ANTHROPIC_API_KEY);
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: key });
  }
  return anthropicClient;
}

async function completeClaude({ prompt, maxTokens, systemPrompt, model }) {
  const client = getAnthropicClient();
  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    ...(systemPrompt ? { system: systemPrompt } : {}),
    messages: [{ role: "user", content: prompt }],
  });
  return extractClaudeText(message);
}

async function completeOpenAI({ prompt, maxTokens, systemPrompt, model }) {
  const apiKey = requireKey("openai", "OPENAI_API_KEY", process.env.OPENAI_API_KEY);
  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || `HTTP ${res.status}`;
    throw new Error(`OpenAI API error: ${msg}`);
  }
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error("OpenAI API returned no text content");
  }
  return text;
}

async function completeGemini({ prompt, maxTokens, systemPrompt, model }) {
  const apiKey = requireKey("gemini", "GEMINI_API_KEY", process.env.GEMINI_API_KEY);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  /** @type {Record<string, unknown>} */
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
    },
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText || `HTTP ${res.status}`;
    throw new Error(`Gemini API error: ${msg}`);
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") {
    throw new Error("Gemini API returned no text in candidates[0].content.parts[0]");
  }
  return text;
}

/**
 * @param {{ prompt: string, maxTokens?: number, systemPrompt?: string }} opts
 * @returns {Promise<string>}
 */
export async function createCompletion({
  prompt,
  maxTokens = 2000,
  systemPrompt = "",
}) {
  try {
    const provider = effectiveProvider();
    const model = modelFor(provider);

    if (typeof prompt !== "string") {
      throw new Error("createCompletion requires a string prompt");
    }

    switch (provider) {
      case "claude":
        return await completeClaude({
          prompt,
          maxTokens,
          systemPrompt,
          model,
        });
      case "openai":
        return await completeOpenAI({
          prompt,
          maxTokens,
          systemPrompt,
          model,
        });
      case "gemini":
        return await completeGemini({
          prompt,
          maxTokens,
          systemPrompt,
          model,
        });
      default:
        throw new Error(`Unsupported provider: ${provider}`);
    }
  } catch (err) {
    console.error("createCompletion failed:", err);
    throw err;
  }
}
