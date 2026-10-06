# QUALITY-A report

## Rows
- PN-DEP-01 / DR-DEP-01: `pnpm-workspace.yaml` catalog gains drizzle-orm and drizzle-kit (exact `1.0.0-rc.4`, RC comment), hono ^4.12.8, esbuild ^0.28.0 (one version for all four users), plus the other repeated deps: jszip, github-slugger, tsup, jsdom, @testing-library/react, @testing-library/jest-dom, @anthropic-ai/claude-agent-sdk, and server-only. 12 manifests now say `catalog:` (agent-worker, terminal-gateway, web, agent-runtime-claude, database, interview-cli, interview-library, interview-playground-control, platform-api, platform-storage, interview, presentation). `packages/code-runner/docker/vitest/package.json` is outside the workspace and keeps its own pins.
- server-only: declared in apps/web (`catalog:`); `biome-ignore` and the stale comment removed in `apps/web/src/platform/server-only.ts`; allowance removed from `scripts/dependency-declarations.test.ts`. The vitest aliases (`vitest.config.ts:49`, `apps/web/vitest.config.ts:23`) are KEPT: the package's default build throws and vitest does not use the react-server condition (reasoned from the package's design, not run without the alias).
- ZD-ARC-01: `z.string().uuid()/.email()/.url()` -> `z.uuid()/z.email()/z.url()` in platform-contracts/platform.ts, platform-integrations/oauth.ts, interview-contracts/schemas.ts, presentation/backend/api.ts (all 19). No fixture needed `z.guid()`; all tests passed. `z.string().datetime()` (7 uses in interview-contracts/schemas.ts) is also deprecated but the audit does not list it: left.
- TS-BLD-01: `isolatedModules: true` in `tsconfig.base.json`; `pnpm typecheck` green (55 tasks), nothing flagged.
- RE-PER-02: index keys kept in all five (no ids exist on the items); a one-line comment each in answer-body.tsx, claim-chips.tsx, coding-panel.tsx, assistant-change.tsx, questions-card.tsx.
- PW-TST-02: both `isVisible()` calls are control-flow branches, not assertions; justified by comments (`e2e/live-session/tests/screenshots-to-model.spec.ts` expectSentAs, `e2e/live-session/src/pages/live-page.ts` captureNewTask).
- AN-DEP-01: defaults now `claude-sonnet-5-5` (apps/web/src/platform/ai.ts:293) and `claude-opus-5-5` (packages/ai-runtime/src/config.ts:191); `.env.example` lines 108,110,121,130 updated. No test pinned the old strings; README had none; ADRs untouched.

## Lockfile diff (85+/47-)
New catalog block entries; server-only@0.0.1 added; esbuild 0.27.7 -> 0.28.1 for web and interview (and vite peer-suffix strings follow); hono 4.12.31 -> 4.13.12 (one hono now; the 4.12.31 entry removed). No other package changes.

## Checks run
- `pnpm typecheck`: 55/55 tasks green.
- Builds: agent-worker and terminal-gateway (bundle-node-app, esbuild 0.28.1), products/interview `build`, `NEXT_DIST_DIR=.next-e2e-qa next build` (route table printed, success; dir is gitignored).
- vitest (scripts, 10 touched packages, apps/web, presentation, interview live/workspace/briefings/react-preview): 2803 passed, 1 failed. The failure is `scripts/env-docs.test.ts`: `CSS_SHOT_DIR` read in `e2e/live-session/tests/zz-css-shots.spec.ts`, a file from the CSS-MOVE worker, not mine.
- biome check --write on touched paths clean.

## UNVERIFIED
- vitest alias for server-only still needed (see above). Browser e2e not run. Docker/DB tests inside the packages above ran as part of the set only if they are in those projects' defaults.
