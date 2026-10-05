// `pnpm test:browser [playwright args]`: runs the live-session browser suite
// after checking what it needs, so a missing requirement is one clear message
// naming the fix instead of a stack trace from deep inside a fixture.
//
//   pnpm test:browser                       the whole suite
//   pnpm test:browser tests/smoke-web-end.spec.ts --project=chromium
//   E2E_HEADED=1 pnpm test:browser          watch the browser
//   E2E_STRICT=1 pnpm test:browser          pending claims fail the run
//   E2E_REBUILD=1 pnpm test:browser         force a fresh `next build`
//   E2E_BROWSER_CHANNEL=chrome ...          use the installed Google Chrome
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const problems = [];

try {
  execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], {
    stdio: "ignore",
  });
} catch {
  problems.push(
    "Docker is not running. The suite starts a disposable PostgreSQL container (postgres:17-alpine); start Docker and rerun.",
  );
}

// The browsers Playwright downloads (`pnpm test:browser:install`). Chrome is
// only needed when E2E_BROWSER_CHANNEL=chrome.
const { chromium, webkit } = require("@playwright/test");
const missing = [];
if (process.env.E2E_BROWSER_CHANNEL !== "chrome") {
  if (!existsSync(chromium.executablePath())) missing.push("chromium");
}
if (!existsSync(webkit.executablePath())) missing.push("webkit");
if (missing.length > 0)
  problems.push(
    `Playwright browsers are not installed (${missing.join(", ")}). Run \`pnpm test:browser:install\` (it downloads Chromium and WebKit once).`,
  );

if (problems.length > 0) {
  console.error(
    `pnpm test:browser cannot run:\n - ${problems.join("\n - ")}\n(The suite also needs the workspace built: \`pnpm build\`.)`,
  );
  process.exit(1);
}

const result = spawnSync(
  "pnpm",
  ["exec", "playwright", "test", ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
