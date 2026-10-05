import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";
import { dockerBackedTests } from "./scripts/docker-tests.mjs";

const require = createRequire(import.meta.url);

// Suites that start a disposable PostgreSQL container need a Docker daemon.
// They run as the `docker` project below so a missing daemon is one clear
// failure and `pnpm test:no-docker` can leave them out. The web and react
// projects keep their own Docker-backed files.
const dockerTests = dockerBackedTests().filter(
  (file) => !file.startsWith("apps/web/") && !file.includes("/src/frontend/"),
);
const nodeInclude = [
  "packages/*/src/**/*.test.ts",
  "scripts/**/*.test.ts",
  "apps/terminal-gateway/src/**/*.test.ts",
  "apps/agent-worker/src/**/*.test.ts",
  "apps/capture-companion/src/**/*.test.ts",
  "products/*/src/**/*.test.ts",
];

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
          include: nodeInclude,
          // Product frontend tests run in the jsdom project below; Docker
          // suites run in the docker project.
          exclude: [
            "**/dist/**",
            "**/node_modules/**",
            "products/*/src/frontend/**",
            "**/*.integration.test.ts",
            ...dockerTests,
          ],
        },
      },
      {
        test: {
          name: "docker",
          environment: "node",
          testTimeout: 10_000,
          // The container waits up to 30 s to accept connections and then
          // migrates, so setup hooks get far more than the 10 s of the
          // Docker-free projects.
          hookTimeout: 120_000,
          include: dockerTests,
          exclude: ["**/dist/**", "**/node_modules/**"],
        },
      },
      {
        test: {
          name: "integration",
          environment: "node",
          // Real-provider checks (a signed-in agent CLI on this machine),
          // started by `pnpm test:integration`; never part of `pnpm test`.
          testTimeout: 120_000,
          hookTimeout: 120_000,
          include: [
            "apps/*/src/**/*.integration.test.ts",
            "packages/*/src/**/*.integration.test.ts",
            "products/*/src/**/*.integration.test.ts",
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
