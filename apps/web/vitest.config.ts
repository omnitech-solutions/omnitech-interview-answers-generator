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
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}"],
    },
  },
});
