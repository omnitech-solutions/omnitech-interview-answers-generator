// Runs web-pages.spec.ts on the browser suite's own isolated stack (disposable PostgreSQL, its own
// `next build` and port; never :3000). It reuses e2e/live-session's config and global setup and
// changes only where the spec lives. From the repository root:
//
//   cd e2e/live-session && E2E_DIST_DIR=.next-e2e-libonly pnpm exec playwright test \
//     --config ../../bionic/briefs/assets/web-library-only/playwright.config.ts
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import base from "../../../../e2e/live-session/playwright.config";

const here = dirname(fileURLToPath(import.meta.url));
const suite = resolve(here, "../../../../e2e/live-session");

export default {
  ...base,
  testDir: here,
  testMatch: /web-pages\.spec\.ts$/,
  timeout: 15 * 60_000,
  globalSetup: join(suite, "src/stack/global-setup.ts"),
  outputDir: join(suite, ".next-e2e-libonly-results"),
  reporter: [["list"]],
  projects: (base.projects ?? []).filter((project) => project.name === "chromium"),
  use: { ...base.use, trace: "off", screenshot: "off" },
};
