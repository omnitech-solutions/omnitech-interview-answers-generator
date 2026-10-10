import { defineConfig } from "vitest/config";

export default defineConfig({
  // Package scripts run with their package as the working directory.
  // Keeping that directory as the root makes test discovery predictable.
  root: process.cwd(),
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
    // An engine a test builds with no `log` stays quiet.
    setupFiles: [
      new URL(
        "./packages/platform-runtime/vitest.engine-quiet.ts",
        import.meta.url,
      ).pathname,
    ],
  },
});
