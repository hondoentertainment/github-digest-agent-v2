import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, "../../data/config.json");
const ALL_SCANNERS = ["builds", "prs", "security", "tokens", "issues", "branches"];

let enabledScanners = loadConfig();

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      if (Array.isArray(config.scanners?.enabled) && config.scanners.enabled.length > 0) {
        return config.scanners.enabled.filter((s) => ALL_SCANNERS.includes(s));
      }
    }
  } catch { /* fall through to env/defaults */ }

  const envVal = process.env.ENABLED_SCANNERS;
  if (!envVal) return [...ALL_SCANNERS];
  const parsed = envVal.split(",").map((s) => s.trim().toLowerCase()).filter((s) => ALL_SCANNERS.includes(s));
  return parsed.length > 0 ? parsed : [...ALL_SCANNERS];
}

function saveConfig() {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let config = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch { /* fresh config */ }

  config.scanners = { enabled: [...enabledScanners] };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getEnabledScanners() {
  return [...enabledScanners];
}

export function setEnabledScanners(scanners) {
  enabledScanners = scanners.filter((s) => ALL_SCANNERS.includes(s));
  if (enabledScanners.length === 0) enabledScanners = [...ALL_SCANNERS];
  saveConfig();
  return [...enabledScanners];
}

export function isScannerEnabled(name) {
  return enabledScanners.includes(name);
}

export function getAllScannerNames() {
  return [...ALL_SCANNERS];
}
