// The one validation of E2E_DIST_DIR, shared by the Playwright config (which
// derives output folders from it, and Playwright clears its output directory
// before any global setup runs) and the stack (which builds into it). The name
// is a single directory with the `.next-e2e` prefix, so every guard, formatter
// and ignore file treats it, and the folders derived from it, as build output.
export function e2eDistDir(env: NodeJS.ProcessEnv = process.env): string {
  const value = env["E2E_DIST_DIR"];
  if (value === undefined || value === "") return ".next-e2e";
  if (
    !value.startsWith(".next-e2e") ||
    /[\\/]/.test(value) ||
    value.includes("..")
  )
    throw new Error(
      "E2E_DIST_DIR must be a single directory name starting with .next-e2e",
    );
  return value;
}

// Playwright's output folders. Dot-directories on purpose: the architecture
// scan skips them, so machine-local results never reach a committed map. A run
// with its own E2E_DIST_DIR gets its own pair (named like its build), because
// Playwright clears the output directory and two runs would delete each
// other's traces.
export function e2eOutputDirs(env: NodeJS.ProcessEnv = process.env): {
  results: string;
  report: string;
} {
  const own = env["E2E_DIST_DIR"] ? e2eDistDir(env) : undefined;
  return own
    ? { results: `./${own}-results`, report: `./${own}-report` }
    : { results: "./.test-results", report: "./.playwright-report" };
}
