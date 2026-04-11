import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGINS_DIR = path.join(__dirname, "../../plugins");

function shouldSkipPluginFile(name) {
  if (!name.endsWith(".js")) return true;
  const base = path.basename(name, ".js");
  if (base.startsWith("_")) return true;
  if (/^readme$/i.test(base)) return true;
  return false;
}

function validatePlugin(plugin, filename) {
  if (plugin == null || typeof plugin !== "object") {
    console.warn(`[pluginLoader] Invalid plugin ${filename}: expected default export object`);
    return false;
  }
  const missing = [];
  if (typeof plugin.key !== "string" || !plugin.key.trim()) missing.push("key");
  if (typeof plugin.category !== "string" || !plugin.category.trim()) missing.push("category");
  if (typeof plugin.emoji !== "string") missing.push("emoji");
  if (typeof plugin.scan !== "function") missing.push("scan function");
  if (missing.length) {
    console.warn(
      `[pluginLoader] Invalid plugin ${filename}: missing or invalid ${missing.join(", ")}`
    );
    return false;
  }
  return true;
}

export function getPluginsDir() {
  return PLUGINS_DIR;
}

export function ensurePluginsDir() {
  if (!fs.existsSync(PLUGINS_DIR)) {
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  }
}

/**
 * Scans plugins/ for .js files, dynamically imports each, validates shape.
 * @returns {Promise<object[]>}
 */
export async function loadPlugins() {
  if (!fs.existsSync(PLUGINS_DIR)) {
    return [];
  }

  let entries;
  try {
    entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
  } catch (err) {
    console.warn("[pluginLoader] Could not read plugins directory:", err.message);
    return [];
  }

  const jsFiles = entries
    .filter((e) => e.isFile() && !shouldSkipPluginFile(e.name))
    .map((e) => e.name);

  const loaded = [];

  for (const name of jsFiles) {
    const fullPath = path.join(PLUGINS_DIR, name);
    try {
      const href = pathToFileURL(fullPath).href;
      const mod = await import(href);
      const plugin = mod.default;
      if (!validatePlugin(plugin, name)) continue;
      loaded.push(plugin);
    } catch (err) {
      console.warn(`[pluginLoader] Failed to load plugin ${name}:`, err.message);
    }
  }

  return loaded;
}
