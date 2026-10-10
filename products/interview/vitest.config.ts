import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

const require = createRequire(import.meta.url);
const exclude = ["dist/**", "node_modules/**"];

// Backend tests run in Node (they use PostgreSQL and Node's URL); frontend
// tests run in jsdom, as the repository-wide configuration does.
export default defineConfig({
  test: {
    clearMocks: true,
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: "backend",
          // An engine a test builds with no `log` stays quiet.
          setupFiles: [
            "../../packages/platform-runtime/vitest.engine-quiet.ts",
          ],
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: [...exclude, "src/frontend/**"],
        },
      },
      {
        extends: true,
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
          name: "frontend",
          environment: "jsdom",
          include: ["src/frontend/**/*.test.{ts,tsx}"],
          exclude,
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
