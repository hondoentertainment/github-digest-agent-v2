import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../../data");
const SCANS_DIR = path.join(DATA_DIR, "scans");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const MAX_HISTORY = parseInt(process.env.MAX_SCAN_HISTORY || "50", 10);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SCANS_DIR)) fs.mkdirSync(SCANS_DIR, { recursive: true });
}

export function saveScan(scanResult) {
  ensureDataDir();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const entry = {
    id,
    timestamp: scanResult.meta.lastRun,
    reposScanned: scanResult.meta.reposScanned,
    totalItems: scanResult.meta.totalItems,
    elapsed: scanResult.meta.elapsed,
  };

  fs.writeFileSync(path.join(SCANS_DIR, `${id}.json`), JSON.stringify(scanResult, null, 2));

  const history = getHistory();
  history.unshift(entry);

  while (history.length > MAX_HISTORY) {
    const removed = history.pop();
    const filePath = path.join(SCANS_DIR, `${removed.id}.json`);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch { /* best effort */ }
  }

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  return id;
}

export function getScan(id) {
  ensureDataDir();
  const filePath = path.join(SCANS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.error(`Corrupt scan file ${id}.json:`, err.message);
    return null;
  }
}

export function getLatestScan() {
  const history = getHistory();
  if (history.length === 0) return null;
  return getScan(history[0].id);
}

export function getPreviousScan() {
  const history = getHistory();
  if (history.length < 2) return null;
  return getScan(history[1].id);
}

export function getHistory() {
  ensureDataDir();
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf-8"));
  } catch (err) {
    console.error("Corrupt history.json:", err.message);
    return [];
  }
}
