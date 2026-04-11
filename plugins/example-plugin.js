// Example custom scanner plugin for GitHub Digest Agent
// Place .js files in this directory to add custom scanners.
// Each file must default-export an object with: key, category, emoji, scan(repos)

export default {
  key: "large-repos",
  category: "Large Repositories",
  emoji: "📦",
  scan: async (repos) => {
    const largeRepos = repos
      .filter((r) => r.size > 100000) // > 100MB
      .map((r) => ({
        repo: r.full_name,
        title: `${r.full_name} is ${Math.round(r.size / 1024)}MB`,
        size: r.size,
        url: r.html_url,
      }));

    return {
      category: "Large Repositories",
      emoji: "📦",
      count: largeRepos.length,
      items: largeRepos,
      summary: largeRepos.length
        ? largeRepos.map((r) => `• ${r.title}`).join("\n")
        : "No oversized repositories found",
    };
  },
};
