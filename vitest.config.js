import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      thresholds: {
        lines: 40,
        functions: 35,
        branches: 30,
        statements: 40,
      },
      exclude: ["node_modules/**", "tests/**", "public/**", "plugins/**"],
    },
  },
});
