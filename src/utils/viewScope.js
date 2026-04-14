import { getUser } from "./users.js";
import { filterScanByOrgAllowList } from "./orgGrouper.js";

/**
 * @param {unknown} raw
 * @returns {string[] | null} null = no restriction (full dashboard)
 */
export function normalizeVisibleOrgs(raw) {
  if (!Array.isArray(raw)) return null;
  const list = raw.map((o) => String(o).trim()).filter(Boolean);
  return list.length ? list : null;
}

/**
 * @param {import("express").Request} req
 * @returns {string[] | null}
 */
export function getVisibleOrgsForRequest(req) {
  const role = req.auth?.role;
  const sub = req.auth?.sub;
  if (role === "admin" || sub === "env" || sub === "anon") return null;
  if (!sub) return null;
  const u = getUser(sub);
  return normalizeVisibleOrgs(u?.preferences?.visibleOrgs);
}

/**
 * @param {object | null | undefined} scan
 * @param {import("express").Request} req
 */
export function filterScanForRequest(scan, req) {
  if (!scan) return scan;
  const orgs = getVisibleOrgsForRequest(req);
  if (!orgs) return scan;
  return filterScanByOrgAllowList(scan, orgs);
}

/**
 * Stable cache key for trend series scoped to the same org allow-list as the dashboard.
 * @param {string[] | null | undefined} orgs
 * @returns {string} empty string = fleet-wide (no restriction)
 */
export function trendScopeKey(orgs) {
  if (!orgs?.length) return "";
  return [...new Set(orgs.map((o) => String(o).trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .join("|");
}
