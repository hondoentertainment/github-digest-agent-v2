import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { atomicWriteJson } from "./atomicWrite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "../../data");
const SCANS_DIR = path.join(DATA_DIR, "scans");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const MAX_HISTORY = parseInt(process.env.MAX_SCAN_HISTORY || "50", 10);

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SCANS_DIR)) fs.mkdirSync(SCANS_DIR, { recursive: true });
}

/**
 * @param {unknown} scan
 * @returns {boolean}
 */
function isValidScanShape(scan) {
  if (!scan || typeof scan !== "object") return false;
  if (!scan.meta || typeof scan.meta !== "object") return false;
  return typeof scan.meta.lastRun === "string";
}

export function saveScan(scanResult) {
  if (!isValidScanShape(scanResult)) {
    throw new Error("Invalid scan result shape");
  }
  ensureDataDir();
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const entry = {
    id,
    timestamp: scanResult.meta.lastRun,
    reposScanned: scanResult.meta.reposScanned,
    totalItems: scanResult.meta.totalItems,
    elapsed: scanResult.meta.elapsed,
  };

  atomicWriteJson(path.join(SCANS_DIR, `${id}.json`), scanResult);

  const history = getHistory();
  history.unshift(entry);

  while (history.length > MAX_HISTORY) {
    const removed = history.pop();
    const filePath = path.join(SCANS_DIR, `${removed.id}.json`);
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      /* best effort */
    }
  }

  atomicWriteJson(HISTORY_FILE, history);
  return id;
}

/**
 * Overwrite an existing scan JSON file without touching history (e.g. branch delete).
 * @param {string} id
 * @param {object} scanResult
 */
export function writeScanPayload(id, scanResult) {
  if (!id || !isValidScanShape(scanResult)) return;
  ensureDataDir();
  const filePath = path.join(SCANS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return;
  atomicWriteJson(filePath, scanResult);
}

/**
 * @returns {string|null}
 */
export function getLatestHistoryId() {
  const history = getHistory();
  return history.length ? history[0].id : null;
}

export function getScan(id) {
  ensureDataDir();
  const filePath = path.join(SCANS_DIR, `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!isValidScanShape(data)) {
      console.error(`Scan ${id}.json failed schema check`);
      return null;
    }
    return data;
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
