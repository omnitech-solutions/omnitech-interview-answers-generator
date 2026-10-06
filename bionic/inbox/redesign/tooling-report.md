# TOOLING report

## PW-TST-04: CI workflow
- `.github/workflows/ci.yml` (new). Triggers: pull_request, push to master, workflow_dispatch. `permissions: contents: read`; concurrency group cancels superseded runs; no secrets.
- Jobs: `verify` (ubuntu, Node 22, corepack pnpm from `packageManager` 10.33.3, `pnpm install --frozen-lockfile`, `pnpm runner:build`, `pnpm verify`); `native` (macos-latest, `node scripts/verify-native.mjs`); `e2e` (ubuntu: install, runner:build, `pnpm build`, `pnpm test:browser:install`, `playwright install-deps`, `pnpm test:browser` as 4 shards in one job, uploads `e2e/live-session/.playwright-report` and `.test-results` on failure).
- Native: `verify-native.mjs` prints "skipped: not macOS" and exits 0 on Linux, so `pnpm verify` there is green without Swift. That is stated in the workflow comment; the `native` macOS job is what really runs Swift. UNVERIFIED that the macOS runner builds the packages.
- No `.nvmrc` exists; Node 22 is set from `engines.node >=22`.
- Actions pinned to majors (checkout@v4, setup-node@v4, upload-artifact@v4). Full-SHA pinning needs a network lookup and was not done.
- Validated only as YAML (ruby `YAML.load_file`: 3 jobs parse). actionlint is not installed. It has NOT run on GitHub and only takes effect once pushed. Unknown whether Docker image layers, `--with-deps` libraries, or runner time limits suffice.
- README: new "CI" section at the end.

## VT-TST-02: `unstubEnvs`
- `unstubEnvs: true` in `apps/web/vitest.config.ts` and in each of the four inline projects (node, docker, integration, react) of `vitest.config.ts`. Projects do not inherit root test options, hence one per project.
- Files with `vi.stubEnv` (git grep, 18 test files): the 3 that broke were fixed by moving `vi.stubEnv` from `beforeAll` to `beforeEach` (a `stubEnvironment()` helper in the two route tests, also called once in `beforeAll` before the dynamic `import("./route")`): `apps/web/app/pages.test.tsx`, `apps/web/app/api/[[...route]]/route.test.ts`, `.../session-ingest.test.ts`. Assertions unchanged. (pages.test.tsx is also being edited by others; my edit was targeted.)
- Counts on the 18 files (`vitest run`, JSON reporter): before 145 passed / 0 failed; with the flag, unfixed 114 / 31 failed; after the fix 145 passed / 0 failed.
- `pnpm test:no-docker` after: 4140 passed, 6 failed (8 failed suites reported). None are mine: `products/interview/src/backend/api.test.ts` (2; fails identically with the flag turned off, 401 vs 503, uses `process.env` not stubEnv), `scripts/export-surface.test.ts` (product-interview 83 exports vs 82 recorded), `panels.test.tsx` and `signed-out.test.tsx` (native-shell frontend, in-flight from other workers), and `scripts/tenant-context-boundary.test.ts` (failed once, passed on re-run, 11/11). `pnpm exec vitest run scripts`: 96 passed, 2 failed (`export-surface`, `env-docs`: `DATABASE_OWNER_URL` is read in `packages/database/src/migrate-command.ts` but not documented; another worker's change).
- I did not collect a before-count for `test:no-docker` itself.

## PN-DEP-02: `vendor/README.md` (new)
Table of all 10 tarballs (package, version, sibling repo and directory), derived from tarball `package.json`, `package.json` overrides, `scripts/assistant-sync.mjs`, and the sibling checkouts at `../`. Marked unknown: the sibling commit each was packed from, whether `pnpm pack` or `npm pack` was used (the script header says pnpm, the README says npm), and why registry or `workspace:` links were not chosen. Notes that `assistant-sync.mjs` covers six of the packages and only refreshes node_modules, not `vendor/`.

## Item 5: docs-arch OCR gap
- `scripts/docs-arch-aside.mjs` (new): `withAside(dir, task, onSignal)` renames `apps/web/public/ocr` to `ocr.docs-arch-aside` (same filesystem, atomic, never copied or deleted), restores in `finally` and on SIGINT/SIGTERM (exit 130/143), restores a leftover from a killed run at the next start, and never overwrites a directory recreated meanwhile (keeps both and says so).
- `scripts/docs-arch.mjs`: now spawns `uv` asynchronously inside `withAside` (so signal handlers can run; `spawnSync` would block them) and forwards the signal to the child. Applies to both `docs:arch` and `docs:arch:check`.
- `scripts/docs-arch-aside.test.ts` (new, 8 tests): restore on success, on throw, missing directory, leftover recovery, no overwrite, and SIGINT/SIGTERM via a real child process; plus a no-op case. With `arch-extractor.test.ts`: 15 passed. biome clean.
- NOT run: the real `pnpm docs:arch` / `docs:arch:check` (source is changing under other workers), so the end-to-end drift fix is UNVERIFIED. The aside leaves `ocr.docs-arch-aside` only if the process is SIGKILLed.

## ADR text / wave 2
None. Wave 2: add a `DATABASE_OWNER_URL` entry to `.env.example` (whoever owns it); the CI workflow needs a first real run on GitHub.
