// The running stack as tests see it. The global setup (one process) starts
// everything and publishes this JSON in E2E_STACK_CONFIG; the Playwright
// workers inherit it. Nothing here is a secret of the person's machine: the
// database is a disposable container and the secrets are generated per run.
export type StackConfig = {
  // The built Next app (`next start`), on a free loopback port.
  webUrl: string;
  // Scenario control API, the fixture problem page and the fake model endpoint.
  controlUrl: string;
  // The fixture page that plays "the problem on screen".
  problemUrl: string;
  // The disposable database's owner URL (user `fixture_owner`, loopback only):
  // tests READ with it, plus ONE write, `moveClock`, which runs with triggers
  // off on this disposable fixture database only. The app itself only ever
  // runs as the member role.
  ownerUrl: string;
  tenantSlug: string;
  // Playwright storageState for the signed-in local user.
  storageStatePath: string;
  // This run's content-free worker trace log and the web server's stdout and
  // stderr (under `.stack/<pid>/`, gitignored): the privacy spec reads both.
  workerLogPath: string;
  webLogPath: string;
};

export const STACK_ENV = "E2E_STACK_CONFIG";

export function stackConfig(): StackConfig {
  const raw = process.env[STACK_ENV];
  if (!raw)
    throw new Error(
      `${STACK_ENV} is not set: run the suite through \`pnpm test:browser\` so the global setup starts the stack.`,
    );
  const config = JSON.parse(raw) as StackConfig;
  assertDisposableOwner(config.ownerUrl);
  return config;
}

// The owner URL comes from an environment variable: refuse anything but the
// fixture's owner on loopback before a spec reads, or writes, with it.
function assertDisposableOwner(ownerUrl: string): void {
  let url: URL;
  try {
    url = new URL(ownerUrl);
  } catch {
    throw new Error(`${STACK_ENV}.ownerUrl is not a URL`);
  }
  if (
    decodeURIComponent(url.username) !== "fixture_owner" ||
    url.hostname !== "127.0.0.1"
  )
    throw new Error(
      `${STACK_ENV}.ownerUrl must be the disposable database's fixture_owner on 127.0.0.1; refusing to use it`,
    );
}
