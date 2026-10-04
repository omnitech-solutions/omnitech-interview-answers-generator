import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);

export default defineConfig({
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: "react/jsx-runtime",
        replacement: require.resolve("react/jsx-runtime"),
      },
      {
        find: "react/jsx-dev-runtime",
        replacement: require.resolve("react/jsx-dev-runtime"),
      },
      { find: "react", replacement: require.resolve("react") },
      { find: "react-dom", replacement: require.resolve("react-dom") },
    ],
  },
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          // The suites boot real servers and workers; 10 s is the ceiling.
          testTimeout: 10_000,
          hookTimeout: 10_000,
          include: [
            "packages/*/src/**/*.test.ts",
            "scripts/**/*.test.ts",
            "apps/terminal-gateway/src/**/*.test.ts",
            "apps/agent-worker/src/**/*.test.ts",
            "apps/capture-companion/src/**/*.test.ts",
            "products/*/src/**/*.test.ts",
          ],
          // Product frontend tests run in the jsdom project below.
          exclude: [
            "**/dist/**",
            "**/node_modules/**",
            "products/*/src/frontend/**",
          ],
        },
      },
      {
        resolve: {
          dedupe: ["react", "react-dom"],
          alias: [
            {
              find: "react/jsx-runtime",
              replacement: require.resolve("react/jsx-runtime"),
            },
            {
              find: "react/jsx-dev-runtime",
              replacement: require.resolve("react/jsx-dev-runtime"),
            },
            { find: "react", replacement: require.resolve("react") },
            { find: "react-dom", replacement: require.resolve("react-dom") },
          ],
        },
        test: {
          name: "react",
          environment: "jsdom",
          testTimeout: 10_000,
          hookTimeout: 10_000,
          include: ["products/*/src/frontend/**/*.test.{ts,tsx}"],
          setupFiles: ["./products/interview/vitest.setup.ts"],
        },
      },
      "apps/web/vitest.config.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: [
        "packages/*/src/**/*.ts",
        "apps/*/src/**/*.{ts,tsx}",
        "apps/web/app/**/*.{ts,tsx}",
        "products/*/src/**/*.{ts,tsx}",
      ],
      // Only test code itself is excluded: tests, declarations, build output,
      // and the disposable PostgreSQL fixtures tests start.
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "**/dist/**",
        "packages/database/src/test-support/**",
        "products/interview/src/backend/assistant/workspace-fixture.ts",
      ],
      thresholds: {
        branches: 80,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
  },
});
