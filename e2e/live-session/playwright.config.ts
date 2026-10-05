import { defineConfig, devices } from "@playwright/test";
import { e2eOutputDirs } from "./src/stack/dist-dir";

// Chromium (bundled, `pnpm test:browser:install`) is the main project; WebKit
// is the engine the native panel's WKWebView uses, so the native-shim and smoke
// specs also run there. E2E_BROWSER_CHANNEL=chrome switches the Chromium
// project to the installed Google Chrome. Automatic screen share and a fake
// microphone come from launch flags, so nothing prompts.
const channel = process.env["E2E_BROWSER_CHANNEL"];
const headed = process.env["E2E_HEADED"] === "1";
// Output folders are dot-directories (so the architecture scan skips them) and
// per E2E_DIST_DIR (validated in src/stack/dist-dir.ts, before Playwright
// clears anything).
const { results, report } = e2eOutputDirs();

const chromiumLaunch = {
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--auto-select-desktop-capture-source=Entire screen",
    "--auto-accept-this-tab-capture",
  ],
};

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // One stack, one disposable database: specs share it, each starts its own
  // session, and the web specs run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  outputDir: results,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: report }],
    // E2E_LIVE=1: a timestamped START/END line per test (src/reporters).
    ...(process.env["E2E_LIVE"] === "1"
      ? ([["./src/reporters/live-reporter.ts"]] as const)
      : []),
  ],
  globalSetup: "./src/stack/global-setup.ts",
  use: {
    headless: !headed,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(channel ? { channel } : {}),
        // The fake device makes the grant safe; WebKit gets none (its
        // microphone is replaced in the page, src/fixtures/webkit-mic-guard.ts).
        permissions: ["microphone"],
        launchOptions: chromiumLaunch,
      },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      // The engine of the native WKWebView: the native-panel specs (@native,
      // @smoke-native) and the browser-neutral smoke specs (@webkit). Screen
      // share is a Chromium capability, so the capture specs stay off WebKit.
      grep: /@native|@smoke-native|@webkit/,
    },
  ],
});
