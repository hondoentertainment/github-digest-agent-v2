import dotenv from "dotenv";
dotenv.config();

const ALL_SCANNERS = ["builds", "prs", "security", "tokens", "issues", "branches"];

let enabledScanners = parseEnvScanners();

function parseEnvScanners() {
  const envVal = process.env.ENABLED_SCANNERS;
  if (!envVal) return [...ALL_SCANNERS];
  const parsed = envVal.split(",").map((s) => s.trim().toLowerCase()).filter((s) => ALL_SCANNERS.includes(s));
  return parsed.length > 0 ? parsed : [...ALL_SCANNERS];
}

export function getEnabledScanners() {
  return [...enabledScanners];
}

export function setEnabledScanners(scanners) {
  enabledScanners = scanners.filter((s) => ALL_SCANNERS.includes(s));
  if (enabledScanners.length === 0) enabledScanners = [...ALL_SCANNERS];
  return [...enabledScanners];
}

export function isScannerEnabled(name) {
  return enabledScanners.includes(name);
}

export function getAllScannerNames() {
  return [...ALL_SCANNERS];
}
