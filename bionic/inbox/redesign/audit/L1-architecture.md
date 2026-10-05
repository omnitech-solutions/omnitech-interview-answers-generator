# L1 audit: architecture and package boundaries

Read-only audit, branch feat/active-session, 2026-10-04. DB layer is in `drizzle-audit.md` and not repeated.

## 1. Scope and method

- Inspected: 5 apps (web, agent-worker, terminal-gateway, capture-companion; studio-shell is Swift, not read), 23 packages, 2 products. Every non-test and test `.ts/.tsx` (excluding node_modules, dist, .next, drizzle).
- Built the real graph with the TypeScript compiler API (`scratchpad/l1/graph.mjs`, output `scratchpad/l1/out.json`): per-file import/export/dynamic-import specifiers; package edges (production code only); package-level and file-level cycle detection (Tarjan SCC); relative imports that escape a package; subpath imports vs each `exports` map; external deps declared vs imported (prod vs test); tsconfig `references` vs real edges.
- Read: `scripts/package-boundaries.test.ts` (the existing guard), ADR rule table, `apps/web/src/platform/*`, `products/interview/src/backend/{api,services,interview-backend}.ts`, `packages/platform-*`, `interview-storage`, `interview-library`, `turbo.json`, tsconfigs.
- Commands run: `pnpm exec vitest run scripts/package-boundaries.test.ts`; `pnpm exec vitest run packages/platform-runtime/src/registry.test.ts "apps/web/app/api/[[...route]]/route.test.ts"`; the four `git grep` checks of INV-0005..0008.
- NOT run: INV-0001/0002/0003 (DB layer, may need Postgres); no Knip/jscpd (other layers); did not read the Swift apps or the ~72k-line product internals beyond the import edges.

### Invariant results

| Check | Result | Note |
|---|---|---|
| INV-0009 package-boundaries-hold | PASS (15/15) | |
| INV-0004 routes-resolve-membership-first | PASS (27/27) | Ledger says `fail` (reconciliation.yml, 2026-10-02): stale. But see arch-01: the test covers platform routes, not the interview `/api/v1/*` surface |
| INV-0007 frontend never imports apps/web | PASS (no output) | |
| INV-0008 domain never imports next | PASS (no output) | |
| INV-0005 nextjs never launches agent | LITERAL FAIL, benign | 4 hits: `apps/web/next.config.ts:1` (git build id), `route.test.ts:2`, `session-ingest.test.ts:6`, `pages.test.tsx:2` (tests). No `agent-runtime-*` in apps/web. Check's grep should exclude tests and next.config |
| INV-0006 no provider-name branching | PASS-with-review | 3 hits; one is a real branch (arch-06) |

## 2. Findings

| ID | Sev | Evidence | Rule | Fix | Lines | Risk | ADR? |
|---|---|---|---|---|---|---|---|
| arch-01 | HIGH | `products/interview/src/backend/api.ts:182-190` (only `authenticate`), `:701-770` (`/api/v1/run`, `/syntax-check`, `/run-all`, `/react-preview` call `codeRunner`), library/answers/explanations CRUD `:339-700`; mounted at `/` in `interview-backend.ts:237-245`, served by `apps/web/app/api/[[...route]]/route.ts`. `authenticate` passes if `INTERVIEW_API_TOKEN` is unset, or if `Origin`/`Sec-Fetch-Site` look same-origin (client-supplied, spoofable by curl). `resolveScope` is only called at `:321` (generate). Data is process-global JSON files (`services.ts:25-33`, no tenant in `packages/interview-storage`) | ADR-0004 rule 4 (membership before domain work), ADR-0005 | Put `/api/v1/*` behind `resolveScope` (membership + permission, 404 otherwise), tenant-key the JSON repos or move them to Postgres; or restrict this surface to a local-only/dev flag. Inferred: it was written for the local CLI/Playground | 150-400 | med | y (amend ADR-0004: what is the local tool API in a multi-tenant host) |
| arch-02 | MEDIUM | HTTP API paths do not follow `/t/:tenant/p/:product/*`: `/api/v1/...`, `/api/interview/...`, `/api/presentation/v1/...`, `/api/platform/v1/...`; tenant arrives as `x-omnitech-tenant` header or `?tenant=` (`interview-backend.ts:~85`, `api.ts` platform routes) | ADR-0004 (page routes comply: `apps/web/app/t/[tenantSlug]/p/[productId]/[[...productPath]]/page.tsx`) | Either record that the rule covers pages only and APIs use header/query tenant, or add the shape. Pick one | 20 doc / 300 code | low/high | y |
| arch-03 | MEDIUM | Error envelopes differ: `packages/platform-api/src/router.ts` returns `{error:{...}}`; `apps/web/src/platform/api.ts:~39` and `agent-api.ts:~58` return `{error:"..."}`; non-member returns 401 in agent-api vs 404 elsewhere (INV-0004 says 404) | inconsistency | One `apiError()` helper in platform-contracts/platform-api, used by the web shell and products | 80 | low | n |
| arch-04 | MEDIUM | `apps/web/src/platform/ai.ts` is 620 lines: raw provider HTTP (fal `:303`, ComfyUI `:364-379`, OpenAI images `:464`, `readImageResponse :144`) with default model ids; also product-specific policy (`interviewAssistantBudget :175`, interview/presentation profiles `:525-602`). `agent-models.ts` (227) and `agent-api.ts` (250) are domain/job logic (profile allowlist `agent-api.ts:23`, Zod schemas) | ADR-0004 rule 3 (thin shell), ADR-0007 | Move provider transports into `ai-provider-images`/`ai-provider-openai`; move `interviewAssistantBudget` + profiles into `ai-runtime/config` or the product; keep only env-to-config wiring in web. Provider wiring itself stays sanctioned | 500 | med | n |
| arch-05 | MEDIUM | Loopback test and context-budget math duplicated: `apps/web/src/platform/ai.ts:167,177-190`, `apps/agent-worker/src/session-gateway.ts:80-90`, `packages/ai-runtime/src/config.ts:~43 (LOOPBACK_HOSTS),:77` | duplication | Single owner `@omnitech/ai-runtime/config` (`isLoopback`, `assistantContextBudget`) | 60 | low | n |
| arch-06 | MEDIUM | `products/interview/src/frontend/studio/documents/assistant-model.ts:6,36` selects the document target by id `agent/claude-code`; `shared/task-card-model.ts:186-192` maps runtime names for display | INV-0006 / ADR-0007 rule 7 | Select by capability or profile id from the manifest, not by a provider-bound target id; labels may stay if display-only | 30 | low | n |
| arch-07 | MEDIUM | Single-consumer packages: `interview-storage` (only product-interview; 364 lines, JSON files), `interview-library` (only product-interview; 2973 lines mostly seed data), `interview-playground-control` (cli + product). Two persistence paths for product data: JSON files vs Postgres (`platform-storage`) | ADR-0002 (abstraction needs 2nd implementation or independent lifecycle) | Fold `interview-storage` and `interview-library` into `products/interview/src/backend` unless a second consumer is planned; resolves arch-01 storage half | 3.4k moved, ~50 edited | med | y (supersedes part of ADR-0003 package list) |
| arch-08 | MEDIUM | `PostgresAgentJobRepository` constructed in 9 places: `apps/web/src/platform/{ai,agent-api,agent-models}.ts`, `products/interview/src/backend/live-session/{ingest,repository,session-ports,session-purge,session-jobs}.ts` | duplication | One factory exported by `platform-storage` taking the database handle | 40 | low | n |
| arch-09 | MEDIUM | Product registration is edited in 4 places: `apps/web/src/platform/registry.ts`, `products.ts` (backend mount list), `next.config.ts` `transpilePackages`, `apps/web/package.json`; `transpilePackages` omits `product-presentation` (inferred: works via dist) | ADR-0004 rule 4 | Let each product export one `{manifest, frontend, createBackend}` descriptor; registry and products.ts iterate it | 80 | low | n |
| arch-10 | LOW | Product public entrypoints: `product-interview` exports 7 (`./backend ./frontend ./manifest ./assistant ./session-worker ./session-testing ./studio.css`); `./session-testing` is test support in a production export (`session-testing-entry.ts:1-5`); test fixtures ship in `dist` (`live-session/{coding,processor}-fixture.ts`, `live/testing/*-kit.ts`, `presentation/src/frontend/fake-api.ts` import `vitest`/jest-dom at module scope) | ADR-0003 (one entrypoint per surface), test-boundary hygiene | Exclude fixtures from the `tsc -b` build (separate `tsconfig.build.json`); move `session-testing` behind a dev-only export | 40 | low | n |
| arch-11 | LOW | Declared-but-unused deps: `ai-provider-openai` -> `@omnitech-assistant/contracts`; `product-presentation` -> `react-dom`; web -> `react-dom`, `esbuild`, `@omnitech-assistant/{providers,server}` (the last three appear in `next.config.ts serverExternalPackages`, so likely needed: inferred, verify). Imported-but-undeclared: `drizzle-kit` (config file, declared devDep so fine), `tsup` in two CLIs (scripts only). The package-boundaries test checks workspace deps only | ADR-0003 | Remove the two certain ones; add an external-deps guard (section 4) | 4 | low | n |
| arch-12 | LOW | `tsconfig.json` `references` absent in 17 of 20 buildable workspaces (e.g. `packages/platform-api/tsconfig.json` is `composite` with none); `apps/web/tsconfig.json` lists 8 of 17 real deps and includes unused `code-runner`. Build order actually comes from turbo `dependsOn: ^build` over package.json deps, so this is harmless but misleading | inconsistency | Drop `composite` or drop the partial `references` in web | 15 | low | n |
| arch-13 | LOW | `scripts/_scan.tmp.mts` (untracked scratch) sits in the repo and would be picked up by the scripts glob | hygiene | Delete; not mine to remove during the audit | 1 | low | n |

Checked and clean: zero cross-package relative or deep imports; zero package cycles; zero file-level cycles (production files, all workspaces); products never import each other or `apps/web`; no `packages/*` imports a product; `product frontend` and `backend` never import each other; no SQL, Drizzle, or `process.env` secrets reads inside products except through services; only `apps/agent-worker` depends on an agent runtime.

## 3. Duplication map

| Cluster | Locations | Single owner |
|---|---|---|
| Loopback detection, context budget | web `ai.ts:167,177`, worker `session-gateway.ts:80`, `ai-runtime/config.ts:43,77` | `@omnitech/ai-runtime/config` |
| `PostgresAgentJobRepository` construction | 9 files (arch-08) | `platform-storage` factory |
| API error envelope | `platform-api/router.ts`, `web/api.ts`, `web/agent-api.ts`, interview `apiError` in `api.ts` | one helper in `platform-api` |
| Product registration data | `registry.ts`, `products.ts`, `next.config.ts`, web `package.json` | product descriptor |
| OpenAI-compatible image response parsing | `web/ai.ts:144-165` vs `ai-provider-images` | `ai-provider-images` |

## 4. Missing mechanical guards

| Rule | Proposed guard |
|---|---|
| Declared deps equal imported deps for external packages (the test checks workspace deps only) | Extend `scripts/package-boundaries.test.ts` with an `external dependencies` case using the same `workspaceImports` walk; allowlist for tsup/drizzle-kit/test-only files |
| Every HTTP route resolves membership first, including `/api/v1/*` (arch-01) | New `apps/web/app/api/[[...route]]/route-authz.test.ts`: build `createApplicationApi()` with a null-context resolver, enumerate `api.routes`, assert 401/404 for every route not on a named public allowlist |
| `apps/web` stays thin | New case in `package-boundaries.test.ts`: no `drizzle-orm`/`pg` import, no `.select(`/`sql\`` in `apps/web/src` and `app`, max lines per file (e.g. 300) with a visible exemption list that includes `src/platform/ai.ts` |
| One public entrypoint per runtime surface (ADR-0003) | Add an exports-count allowlist per package to the same test; fail on a new subpath without a recorded reason |
| Product frontend and backend never import each other | Direction row in `directionRules`-style table scanning `products/*/src/frontend` vs `backend` |
| Test fixtures do not ship | `scripts/` test asserting each package's build tsconfig excludes `*-fixture.ts`, `*-kit.ts`, `fake-api.ts` |
| Build-time registration is complete | Test that every `products/*` with a manifest appears in `registry.ts`, `products.ts`, and web `package.json` |
| Provider-name branching (INV-0006) is grep-based, so labels and ids pass | Replace the grep with an AST check over `products/*/src` string literals compared in `===`/`find` expressions; keep an allowlist for display maps |
| INV-0005 check text | Narrow the grep to `apps/web/src apps/web/app` excluding `*.test.*`; refresh the ledger rows for INV-0004/0005 (stale in `reconciliation.yml`) |

## 5. Proposed work packages

1. WP-A (security, first): arch-01 plus the route-authz guard. Owns `products/interview/src/backend/api.ts`, `interview-backend.ts`, `apps/web/app/api/**` test. Depends on the ADR amendment (arch-02) and on L-layer owners of `live-session` only for mount order. Tests: route-authz test; existing interview-backend tests unchanged for member requests; new cases for non-member 404, missing token, spoofed `Origin`.
2. WP-B: arch-03, arch-05, arch-08 (small, mechanical). Owns `platform-api`, `ai-runtime/config`, `platform-storage` exports, edits in web and worker. Tests: existing suites plus a unit test for the shared helpers.
3. WP-C: arch-04, arch-06. Owns `apps/web/src/platform/ai.ts` split, `ai-provider-images`, `assistant-model.ts`. Tests: `ai.test.ts` must pass unchanged; add provider transport tests in the packages.
4. WP-D: arch-07 and arch-09 after the owner decides (ADR). Owns `interview-storage`, `interview-library`, `products/interview/src/backend/services.ts`, registry. Depends on WP-A for storage tenancy.
5. WP-E: guards in section 4, arch-10..13. Owns `scripts/*.test.ts`, `bionic/invariants/`.

## 6. Already good

- `scripts/package-boundaries.test.ts` is a real graph guard: declared equals imported, exports-map only, direction table (apps never imported, products never import each other, contracts depend only on contracts, adapters only on contracts, only agent-worker on agent runtimes, worker repository subpath), neutral-core and companion rules with self-tests.
- Clean layering in fact: contracts at the bottom, adapters and runtimes above them, storage and services, products, apps on top; no cycles at package or file level.
- Build-time product registry with duplicate-id and duplicate-route detection (`platform-runtime/registry.ts`), page route shape and 404-first membership for pages.
- `apps/web` contains no SQL and no Drizzle queries; secrets handled by `native-handoff.ts` with hashing and TTL.
