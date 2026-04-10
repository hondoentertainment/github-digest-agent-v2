export function diffScans(current, previous) {
  if (!previous || !current) return null;

  const categories = ["builds", "prs", "security", "tokens", "issues", "branches"];
  const diff = {};

  for (const cat of categories) {
    const currItems = current[cat]?.items || [];
    const prevItems = previous[cat]?.items || [];

    const currKeys = new Set(currItems.map((i) => itemKey(cat, i)));
    const prevKeys = new Set(prevItems.map((i) => itemKey(cat, i)));

    diff[cat] = {
      new: currItems.filter((i) => !prevKeys.has(itemKey(cat, i))).length,
      resolved: prevItems.filter((i) => !currKeys.has(itemKey(cat, i))).length,
      total: currItems.length,
      delta: currItems.length - prevItems.length,
    };
  }

  diff.summary = {
    totalNew: categories.reduce((sum, c) => sum + (diff[c]?.new || 0), 0),
    totalResolved: categories.reduce((sum, c) => sum + (diff[c]?.resolved || 0), 0),
    previousScan: previous.meta?.lastRun,
  };

  return diff;
}

function itemKey(category, item) {
  switch (category) {
    case "builds":
      return `${item.repo}:${item.workflow}:${item.branch}`;
    case "prs":
      return `${item.repo}:${item.number}`;
    case "security":
      return `${item.repo}:${item.type}:${item.package}:${item.title}`;
    case "tokens":
      return `${item.repo}:${item.type}:${item.title}`;
    case "issues":
      return `${item.repo}:${item.number}`;
    case "branches":
      return `${item.repo}:${item.branch}`;
    default:
      return JSON.stringify(item);
  }
}
