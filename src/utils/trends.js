import { getHistory, getScan } from "./storage.js";

const CATEGORY_KEYS = ["builds", "prs", "security", "tokens", "issues", "branches"];

function cutoffMs(days) {
  const n = Number(days);
  const windowDays = Number.isFinite(n) && n >= 0 ? n : 30;
  return Date.now() - windowDays * 24 * 60 * 60 * 1000;
}

function dayKey(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function isInWindow(ts, cutoff) {
  const t = new Date(ts).getTime();
  if (Number.isNaN(t)) return false;
  return t >= cutoff;
}

/**
 * One point per UTC calendar day in range: latest scan that day (by timestamp).
 */
function latestScanPerDayInWindow(history, days) {
  const cutoff = cutoffMs(days);
  const byDay = new Map();

  for (const entry of history) {
    if (!entry?.id || !entry?.timestamp) continue;
    if (!isInWindow(entry.timestamp, cutoff)) continue;
    const day = dayKey(entry.timestamp);
    if (!day) continue;
    const prev = byDay.get(day);
    const curTime = new Date(entry.timestamp).getTime();
    const prevTime = prev ? new Date(prev.timestamp).getTime() : -Infinity;
    if (!Number.isNaN(curTime) && curTime >= prevTime) {
      byDay.set(day, { timestamp: entry.timestamp, id: entry.id });
    }
  }

  return [...byDay.keys()].sort().map((day) => ({ day, id: byDay.get(day).id }));
}

function countFor(scan, key) {
  const v = scan?.[key]?.count;
  if (v == null) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function totalItemsFor(scan) {
  if (!scan) return 0;
  if (scan.meta?.totalItems != null) {
    const n = Number(scan.meta.totalItems);
    if (Number.isFinite(n)) return n;
  }
  return CATEGORY_KEYS.reduce((sum, k) => sum + countFor(scan, k), 0);
}

function trendFromTotals(totals) {
  const len = totals.length;
  if (len < 2) return "stable";
  const mid = Math.floor(len / 2);
  const first = totals.slice(0, mid);
  const second = totals.slice(mid);
  const avgFirst = first.reduce((a, b) => a + b, 0) / first.length;
  const avgSecond = second.reduce((a, b) => a + b, 0) / second.length;
  const eps = 1e-9;
  if (avgFirst > avgSecond + eps) return "improving";
  if (avgFirst < avgSecond - eps) return "worsening";
  return "stable";
}

function buildSeriesForWindow(days) {
  const history = getHistory();
  const rows = latestScanPerDayInWindow(history, days);

  const labels = [];
  const series = {
    builds: [],
    prs: [],
    security: [],
    tokens: [],
    issues: [],
    branches: [],
    total: [],
  };

  for (const { day, id } of rows) {
    labels.push(day);
    const scan = getScan(id);
    series.builds.push(countFor(scan, "builds"));
    series.prs.push(countFor(scan, "prs"));
    series.security.push(countFor(scan, "security"));
    series.tokens.push(countFor(scan, "tokens"));
    series.issues.push(countFor(scan, "issues"));
    series.branches.push(countFor(scan, "branches"));
    series.total.push(totalItemsFor(scan));
  }

  return { labels, series };
}

/**
 * @param {number} [days=30]
 * @returns {{
 *   labels: string[],
 *   series: { builds: number[], prs: number[], security: number[], tokens: number[], issues: number[], branches: number[], total: number[] },
 *   summary: { avgTotal: number, trend: 'improving'|'worsening'|'stable', peakDate: string|null, peakTotal: number }
 * }}
 */
export function getTrends(days = 30) {
  const { labels, series } = buildSeriesForWindow(days);
  const totals = series.total;
  const len = totals.length;
  const avgTotal = len === 0 ? 0 : totals.reduce((a, b) => a + b, 0) / len;

  let peakDate = null;
  let peakTotal = 0;
  if (len > 0) {
    peakTotal = Math.max(...totals);
    peakDate = labels[totals.indexOf(peakTotal)] ?? null;
  }

  return {
    labels,
    series,
    summary: {
      avgTotal: len === 0 ? 0 : Number(avgTotal.toFixed(1)),
      trend: trendFromTotals(totals),
      peakDate,
      peakTotal,
    },
  };
}

const VALID_CATEGORIES = new Set([...CATEGORY_KEYS, "total"]);

/**
 * @param {string} category — builds | prs | security | tokens | issues | branches | total
 * @param {number} [days=30]
 */
export function getCategoryTrend(category, days = 30) {
  const key = String(category ?? "").toLowerCase();
  if (!VALID_CATEGORIES.has(key)) {
    return { labels: [], values: [], change: 0, changePercent: 0 };
  }

  const { labels, series } = buildSeriesForWindow(days);
  const values = key === "total" ? series.total : series[key] ?? [];

  if (values.length === 0) {
    return { labels, values, change: 0, changePercent: 0 };
  }

  const first = values[0];
  const last = values[values.length - 1];
  const change = last - first;

  let changePercent = 0;
  if (first === 0) {
    changePercent = last === 0 ? 0 : 100;
  } else {
    changePercent = Number((((last - first) / first) * 100).toFixed(1));
  }

  return { labels, values, change, changePercent };
}
