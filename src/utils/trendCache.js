import { getTrends, getCategoryTrend, clampTrendDays } from "./trends.js";
import { trendScopeKey } from "./viewScope.js";

/** @type {Map<string, { at: number, data: ReturnType<typeof getTrends> }>} */
const aggregateCache = new Map();
/** @type {Map<string, { at: number, data: ReturnType<typeof getCategoryTrend> }>} */
const categoryCache = new Map();

export function invalidateTrendCache() {
  aggregateCache.clear();
  categoryCache.clear();
}

function aggKey(days, orgNames) {
  return `${days}::${trendScopeKey(orgNames)}`;
}

function catKey(category, days, orgNames) {
  return `${String(category).toLowerCase()}::${aggKey(days, orgNames)}`;
}

/**
 * @param {number|string|undefined} rawDays
 * @param {string[]|null|undefined} orgNames
 */
export function getTrendsCached(rawDays, orgNames) {
  const days = clampTrendDays(rawDays);
  const key = aggKey(days, orgNames);
  const now = Date.now();
  const ttl = parseInt(process.env.TREND_CACHE_TTL_MS || "60000", 10);
  const hit = aggregateCache.get(key);
  if (hit && now - hit.at < ttl) {
    return hit.data;
  }
  const data = getTrends(days, orgNames);
  aggregateCache.set(key, { at: now, data });
  return data;
}

/**
 * @param {string} category
 * @param {number|string|undefined} rawDays
 * @param {string[]|null|undefined} orgNames
 */
export function getCategoryTrendCached(category, rawDays, orgNames) {
  const days = clampTrendDays(rawDays);
  const key = catKey(category, days, orgNames);
  const now = Date.now();
  const ttl = parseInt(process.env.TREND_CACHE_TTL_MS || "60000", 10);
  const hit = categoryCache.get(key);
  if (hit && now - hit.at < ttl) {
    return hit.data;
  }
  const data = getCategoryTrend(category, days, orgNames);
  categoryCache.set(key, { at: now, data });
  return data;
}
