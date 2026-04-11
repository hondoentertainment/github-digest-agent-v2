export default {
  key: "example",
  category: "Example Scanner",
  emoji: "🔌",
  async scan(repos) {
    // Example: count repos with no description
    const items = repos
      .filter((r) => !r.description)
      .map((r) => ({
        repo: r.full_name,
        title: "Repository has no description",
        url: r.html_url,
      }));
    return {
      category: "Example Scanner",
      emoji: "🔌",
      count: items.length,
      items,
      summary: items.length
        ? items.map((i) => `• ${i.repo}: ${i.title}`).join("\n")
        : "All repos have descriptions ✅",
    };
  },
};
