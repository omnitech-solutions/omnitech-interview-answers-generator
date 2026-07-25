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
            "apps/web/src/server/**/*.test.ts",
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
          include: ["apps/web/src/**/*.test.tsx"],
          setupFiles: ["./apps/web/vitest.setup.ts"],
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
      ],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.d.ts",
        "**/dist/**",
        "**/index.ts",
        "**/types.ts",
        "**/public-types.ts",
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
