import { defineConfig } from "vitest/config";

export default defineConfig({
  // Package scripts run with their package as the working directory.
  // Keeping that directory as the root makes test discovery predictable.
  root: process.cwd(),
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
