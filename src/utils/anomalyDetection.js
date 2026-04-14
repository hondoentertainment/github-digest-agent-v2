import { getHistory } from "./storage.js";

/**
 * @param {object | null | undefined} scan
 * @param {{ id?: string; totalItems?: number }[]} historyEntries newest first (excludes current run if not yet saved)
 * @param {{ totalItemsSpikeMultiplier?: number | null; spikeLookback?: number }} rules
 */
export function computeTotalItemsSpike(scan, historyEntries, rules) {
  const mult = rules?.totalItemsSpikeMultiplier;
  if (mult == null || typeof mult !== "number" || mult <= 1 || !Number.isFinite(mult)) {
    return { triggered: false, reason: null, baseline: null, current: null, lookback: 0 };
  }
  const lookback = Math.min(50, Math.max(2, parseInt(String(rules?.spikeLookback ?? 8), 10) || 8));
  const current = scan?.meta?.totalItems;
  if (typeof current !== "number" || current < 0) {
    return { triggered: false, reason: null, baseline: null, current: null, lookback };
  }
  const hist = Array.isArray(historyEntries) ? historyEntries : [];
  const totals = hist.slice(0, lookback).map((h) => h.totalItems).filter((n) => typeof n === "number");
  if (totals.length < 2) {
    return { triggered: false, reason: null, baseline: null, current, lookback: totals.length };
  }
  const baseline = totals.reduce((a, b) => a + b, 0) / totals.length;
  if (baseline <= 0) return { triggered: false, reason: null, baseline, current, lookback: totals.length };
  if (current >= baseline * mult) {
    return {
      triggered: true,
      reason: `total items spike: ${current} vs ~${baseline.toFixed(1)} avg (last ${totals.length} scans, ${mult}× rule)`,
      baseline,
      current,
      lookback: totals.length,
    };
  }
  return { triggered: false, reason: null, baseline, current, lookback: totals.length };
}

/**
 * @param {object | null | undefined} scan
 * @param {object} rules from getAlertRules()
 */
export function evaluateTotalItemsSpikeFromHistory(scan, rules) {
  return computeTotalItemsSpike(scan, getHistory(), rules);
}

/**
 * API payload: spike rule evaluation + optional prior-scan jump.
 * @param {object | null | undefined} scan
 * @param {object | null | undefined} previousScan
 * @param {object} rules
 */
export function buildAnomalyReport(scan, previousScan, rules) {
  const spike = evaluateTotalItemsSpikeFromHistory(scan, rules);
  const alerts = [];
  if (spike.triggered && spike.reason) {
    alerts.push({ kind: "spike", severity: "warning", message: spike.reason });
  }

  const prevTotal = previousScan?.meta?.totalItems;
  const curTotal = scan?.meta?.totalItems;
  if (typeof prevTotal === "number" && typeof curTotal === "number" && prevTotal >= 10) {
    const jump = curTotal / prevTotal;
    if (jump >= 2 && curTotal - prevTotal >= 5) {
      alerts.push({
        kind: "scan_over_scan_jump",
        severity: "info",
        message: `Large jump vs previous scan: ${prevTotal} → ${curTotal} items (${jump.toFixed(1)}×)`,
      });
    }
  }

  return {
    spikeEvaluation: {
      triggered: spike.triggered,
      baseline: spike.baseline,
      current: spike.current,
      lookbackScans: spike.lookback,
      multiplier: rules?.totalItemsSpikeMultiplier ?? null,
    },
    alerts,
  };
}
