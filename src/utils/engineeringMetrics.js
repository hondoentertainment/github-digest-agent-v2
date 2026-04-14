/**
 * DORA-lite signals derived from a single scan snapshot (no historical deploy log).
 * @param {object} scan
 */
export function computeEngineeringMetrics(scan) {
  if (!scan || typeof scan !== "object") {
    return {
      openPRCount: 0,
      prAgeDaysP50: 0,
      prAgeDaysP90: 0,
      failedBuildCount: 0,
      securityAlertCount: 0,
      staleBranchCount: 0,
    };
  }

  const prs = scan.prs?.items;
  const ages = Array.isArray(prs)
    ? prs.map((p) => Number(p.ageDays)).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b)
    : [];

  const pct = (arr, p) => {
    if (!arr.length) return 0;
    const idx = Math.min(arr.length - 1, Math.floor((p / 100) * arr.length));
    return arr[idx];
  };

  return {
    openPRCount: Array.isArray(prs) ? prs.length : 0,
    prAgeDaysP50: pct(ages, 50),
    prAgeDaysP90: pct(ages, 90),
    failedBuildCount: scan.builds?.count ?? 0,
    securityAlertCount: scan.security?.count ?? 0,
    staleBranchCount: scan.branches?.count ?? 0,
  };
}
