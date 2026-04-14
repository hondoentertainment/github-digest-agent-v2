import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { atomicWriteJson } from "./atomicWrite.js";
import { evaluateTotalItemsSpikeFromHistory } from "./anomalyDetection.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, "../../data/config.json");

const DEFAULT_RULES = {
  securityCountGt: null,
  failedBuildsGt: null,
  pageOnCriticalSecurity: false,
  slackMention: "",
  /** @type {number | null} e.g. 2 = page when totalItems ≥ 2× rolling average */
  totalItemsSpikeMultiplier: null,
  spikeLookback: 8,
};

function loadConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveConfigPartial(updates) {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  let config = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch {
    /* fresh */
  }
  config.alerts = { ...(config.alerts || {}), ...updates };
  atomicWriteJson(CONFIG_FILE, config);
}

export function getAlertRules() {
  const c = loadConfig();
  return { ...DEFAULT_RULES, ...(c.alerts || {}) };
}

export function setAlertRules(updates) {
  const next = { ...getAlertRules() };
  if (typeof updates.securityCountGt === "number" && updates.securityCountGt >= 0) {
    next.securityCountGt = updates.securityCountGt;
  }
  if (updates.securityCountGt === null) next.securityCountGt = null;

  if (typeof updates.failedBuildsGt === "number" && updates.failedBuildsGt >= 0) {
    next.failedBuildsGt = updates.failedBuildsGt;
  }
  if (updates.failedBuildsGt === null) next.failedBuildsGt = null;

  if (typeof updates.pageOnCriticalSecurity === "boolean") {
    next.pageOnCriticalSecurity = updates.pageOnCriticalSecurity;
  }
  if (typeof updates.slackMention === "string") {
    next.slackMention = updates.slackMention;
  }

  if (typeof updates.totalItemsSpikeMultiplier === "number" && updates.totalItemsSpikeMultiplier > 1 && updates.totalItemsSpikeMultiplier <= 50) {
    next.totalItemsSpikeMultiplier = updates.totalItemsSpikeMultiplier;
  }
  if (updates.totalItemsSpikeMultiplier === null) next.totalItemsSpikeMultiplier = null;

  if (typeof updates.spikeLookback === "number" && updates.spikeLookback >= 2 && updates.spikeLookback <= 50) {
    next.spikeLookback = updates.spikeLookback;
  }

  saveConfigPartial(next);
  return next;
}

/**
 * @param {object} scan
 * @returns {{ triggered: boolean, reasons: string[] }}
 */
export function evaluateAlertRules(scan) {
  const rules = getAlertRules();
  const reasons = [];
  const sec = scan?.security?.count ?? 0;
  const builds = scan?.builds?.count ?? 0;

  if (rules.securityCountGt != null && sec > rules.securityCountGt) {
    reasons.push(`security count ${sec} > ${rules.securityCountGt}`);
  }
  if (rules.failedBuildsGt != null && builds > rules.failedBuildsGt) {
    reasons.push(`failed builds ${builds} > ${rules.failedBuildsGt}`);
  }
  if (rules.pageOnCriticalSecurity) {
    const critical = (scan?.security?.items || []).some((i) => i.severity === "critical");
    if (critical) reasons.push("critical security alert present");
  }

  const spike = evaluateTotalItemsSpikeFromHistory(scan, rules);
  if (spike.triggered && spike.reason) {
    reasons.push(spike.reason);
  }

  return { triggered: reasons.length > 0, reasons };
}
