import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, "../../data/config.json");

const DEFAULTS = {
  staleBranchDays: parseInt(process.env.STALE_BRANCH_DAYS || "30", 10),
  buildWindowHours: parseInt(process.env.BUILD_WINDOW_HOURS || "24", 10),
  severityThreshold: process.env.SEVERITY_THRESHOLD || "low",
  maxItemsPerScanner: parseInt(process.env.MAX_ITEMS_PER_SCANNER || "100", 10),
};

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, warning: 3, unknown: 4 };

let rules = loadRules();

function loadRules() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      return { ...DEFAULTS, ...(config.rules || {}) };
    }
  } catch { /* use defaults */ }
  return { ...DEFAULTS };
}

function saveRules() {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let config = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch { /* fresh config */ }

  config.rules = { ...rules };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getRules() {
  return { ...rules };
}

export function setRules(updates) {
  const valid = {};
  if (typeof updates.staleBranchDays === "number" && updates.staleBranchDays > 0) valid.staleBranchDays = updates.staleBranchDays;
  if (typeof updates.buildWindowHours === "number" && updates.buildWindowHours > 0) valid.buildWindowHours = updates.buildWindowHours;
  if (typeof updates.severityThreshold === "string" && updates.severityThreshold in SEVERITY_ORDER) valid.severityThreshold = updates.severityThreshold;
  if (typeof updates.maxItemsPerScanner === "number" && updates.maxItemsPerScanner > 0) valid.maxItemsPerScanner = updates.maxItemsPerScanner;

  rules = { ...rules, ...valid };
  saveRules();
  return { ...rules };
}

export function meetsThreshold(severity) {
  const threshold = SEVERITY_ORDER[rules.severityThreshold] ?? 3;
  const level = SEVERITY_ORDER[severity] ?? 4;
  return level <= threshold;
}

export function getStaleBranchDays() {
  return rules.staleBranchDays;
}

export function getBuildWindowHours() {
  return rules.buildWindowHours;
}

export function getMaxItems() {
  return rules.maxItemsPerScanner;
}
