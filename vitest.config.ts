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
          include: [
            "packages/*/src/**/*.test.ts",
            "apps/terminal-gateway/src/**/*.test.ts",
            "products/*/src/backend/**/*.test.ts",
          ],
          exclude: ["**/dist/**", "**/node_modules/**"],
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
          include: ["products/*/src/frontend/**/*.test.tsx"],
          setupFiles: ["./products/interview/vitest.setup.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "./coverage",
      include: [
        "packages/*/src/**/*.ts",
        "apps/terminal-gateway/src/**/*.ts",
        "apps/web/src/**/*.{ts,tsx}",
        "products/*/src/**/*.{ts,tsx}",
      ],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "**/benchmark.ts",
        // Disposable PostgreSQL for tests; it is test infrastructure, not product code.
        "products/interview/src/backend/assistant/workspace-fixture.ts",
        "packages/interview-rulesync-codex/src/cli.ts",
        "**/dist/**",
        "**/index.ts",
        "**/types.ts",
        "**/public-types.ts",
        "apps/web/src/platform/**",
        "packages/platform-contracts/src/platform.ts",
        "packages/platform-integrations/src/oauth.ts",
        "packages/platform-storage/src/bootstrap.ts",
        "packages/platform-storage/src/database.ts",
        "packages/platform-storage/src/migrate.ts",
        "packages/platform-storage/src/platform-repository.ts",
        "packages/platform-storage/src/agent-job-repository.ts",
        "apps/terminal-gateway/src/render-event.ts",
        "packages/platform-api/src/router.ts",
        "packages/platform-runtime/src/registry.ts",
        // Presentation UI/API paths are exercised by product and browser checks,
        // not the repository-wide unit coverage project.
        "products/presentation/src/**",
        "products/*/src/manifest.tsx",
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
