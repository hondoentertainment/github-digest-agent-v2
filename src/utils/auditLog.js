import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { atomicWriteJson } from "./atomicWrite.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUDIT_FILE = path.join(__dirname, "../../data/audit.json");
const MAX_ENTRIES = 500;

function ensureDir() {
  const dir = path.dirname(AUDIT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadEntries() {
  try {
    if (!fs.existsSync(AUDIT_FILE)) return [];
    const raw = fs.readFileSync(AUDIT_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * @param {{ action: string, actor?: string, detail?: Record<string, unknown> }} entry
 */
export function appendAudit(entry) {
  try {
    ensureDir();
    const row = {
      ts: new Date().toISOString(),
      action: String(entry.action),
      actor: entry.actor ?? "unknown",
      detail: entry.detail && typeof entry.detail === "object" ? entry.detail : {},
    };
    const entries = loadEntries();
    entries.unshift(row);
    while (entries.length > MAX_ENTRIES) entries.pop();
    atomicWriteJson(AUDIT_FILE, entries);
  } catch (err) {
    console.error("auditLog append failed:", err.message);
  }
}

export function getAuditLog(limit = 100) {
  const entries = loadEntries();
  return entries.slice(0, Math.min(limit, MAX_ENTRIES));
}
