/**
 * Group and filter scan results by GitHub organization / owner (repo "owner/name").
 */

const CATEGORY_KEYS = ["builds", "prs", "security", "tokens", "issues", "branches"];

function ownerFromRepo(repo) {
  if (repo == null || typeof repo !== "string") return null;
  const trimmed = repo.trim();
  if (!trimmed) return null;
  const slash = trimmed.indexOf("/");
  if (slash === -1) return trimmed;
  const owner = trimmed.slice(0, slash).trim();
  return owner || null;
}

function repoStartsWithOrgPrefix(repo, org) {
  if (typeof repo !== "string" || typeof org !== "string") return false;
  const o = org.trim();
  if (!o) return false;
  return repo.startsWith(`${o}/`);
}

function filterCategory(cat, filteredItems) {
  if (cat == null || typeof cat !== "object") {
    return { count: filteredItems.length, items: filteredItems };
  }
  return { ...cat, count: filteredItems.length, items: filteredItems };
}

function emptyScanShell() {
  return {
    meta: { lastRun: undefined, reposScanned: 0, totalItems: 0, elapsed: undefined },
    builds: { count: 0, items: [] },
    prs: { count: 0, items: [] },
    security: { count: 0, items: [] },
    tokens: { count: 0, items: [] },
    issues: { count: 0, items: [] },
    branches: { count: 0, items: [] },
  };
}

/**
 * Unique owner names from all items across all categories, sorted alphabetically.
 * @param {object} scanResult
 * @returns {string[]}
 */
export function getOrgList(scanResult) {
  if (!scanResult || typeof scanResult !== "object") return [];

  const owners = new Set();
  for (const key of CATEGORY_KEYS) {
    const items = scanResult[key]?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const owner = ownerFromRepo(item?.repo);
      if (owner) owners.add(owner);
    }
  }
  return Array.from(owners).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/**
 * When `orgFilter` is null, returns the original `scanResult` unchanged.
 * Otherwise returns a new scan result with items where `item.repo` starts with `orgFilter/`,
 * with per-category counts and `meta.totalItems` / `meta.reposScanned` recalculated.
 * @param {object} scanResult
 * @param {string | null} [orgFilter]
 * @returns {object}
 */
export function groupByOrg(scanResult, orgFilter = null) {
  if (orgFilter == null) {
    return scanResult;
  }

  const orgStr = String(orgFilter).trim();
  const pred =
    orgStr === ""
      ? () => false
      : (item) => repoStartsWithOrgPrefix(item?.repo, orgStr);

  if (!scanResult || typeof scanResult !== "object") {
    return emptyScanShell();
  }

  const out = { ...scanResult };
  let totalItems = 0;
  const uniqueRepos = new Set();

  for (const key of CATEGORY_KEYS) {
    const cat = scanResult[key];
    const items = Array.isArray(cat?.items) ? cat.items : [];
    const filtered = items.filter(pred);
    totalItems += filtered.length;
    for (const it of filtered) {
      if (it?.repo) uniqueRepos.add(it.repo);
    }
    out[key] = filterCategory(cat, filtered);
  }

  const prevMeta = scanResult.meta && typeof scanResult.meta === "object" ? scanResult.meta : {};
  out.meta = {
    ...prevMeta,
    totalItems,
    reposScanned: uniqueRepos.size,
  };

  return out;
}

/**
 * Per-org totals and category breakdown, sorted by totalItems descending.
 * @param {object} scanResult
 * @returns {{ org: string, totalItems: number, breakdown: Record<string, number> }[]}
 */
export function getOrgSummary(scanResult) {
  if (!scanResult || typeof scanResult !== "object") return [];

  const orgs = getOrgList(scanResult);
  const rows = orgs.map((org) => {
    const prefix = `${org}/`;
    const breakdown = {};
    let totalItems = 0;
    for (const key of CATEGORY_KEYS) {
      const items = scanResult[key]?.items;
      const n = Array.isArray(items)
        ? items.filter((item) => typeof item?.repo === "string" && item.repo.startsWith(prefix)).length
        : 0;
      breakdown[key] = n;
      totalItems += n;
    }
    return { org, totalItems, breakdown };
  });

  rows.sort((a, b) => b.totalItems - a.totalItems || a.org.localeCompare(b.org, undefined, { sensitivity: "base" }));
  return rows;
}
