# Technology consistency audit (repo vs official documentation)

## 1. Header

- Date: 2026-10-05. Repo HEAD: `3ae02b9` (branch `feat/active-session`, tree clean at start).
- This is **model analysis against captured documentation, not a certification.** Nothing was executed against a database, browser, container, provider or the native app. Findings are what I read in code and in the captured docs; anything inferred or not checked is marked UNVERIFIED.
- Method: read `bionic/objectives.md`, AGENTS.md, `technology-references.md` and the router skill; reused the filed sources (Vercel React skills, Swift concurrency skill, six Drizzle pages); shallow-cloned the official docs repositories for the other technologies at the installed version where a tag existed; used WebFetch for sites with no docs repository; then grepped and read the code with file:line evidence. Repository rules (AGENTS.md, ADRs, invariants) win over documentation; a mismatch they justify is a "documented deviation".
- Caveat on authority: ADR-0004, -0005, -0006, -0007, -0015, -0020, -0021, -0022 and -0023 are still **Proposed**, not Accepted (`status:` front matter in `bionic/adrs/`). Deviations justified only by those are labelled documented, but their backing is weaker than the AGENTS.md wording suggests (see section 5).
- Requirement levels: taken from the doc's own wording where it has any ("must", "should", "consider", "recommended"). Where the doc gives no wording I inferred the level and wrote "(inferred)".
- Prior in-repo audits exist (`bionic/inbox/redesign/audit/L1..L6`, `plan.md`). I did not rely on them for status; I cite them only where they confirm a known gap.

### Not checked, and why
- Not run: dev server, browser, Docker, Playwright, native app, any model call, `pnpm verify`, `vitest` (no confirmation needed, and the DB-backed suites need Docker). Runtime RLS behaviour is therefore UNVERIFIED by execution; I read migrations and guards only.
- Docs not captured: TypeScript handbook, Apple WebKit/ScreenCaptureKit/Vision docs, Docker Hub `postgres` image page, Mermaid, React reference docs, OAuth RFCs, `ws`, `pg-boss`. Sections on those say so.
- `apps/terminal-gateway` (ws), `pg-boss`, `platform-integrations` OAuth internals, `docs-site`-style product content, CodeMirror/shiki internals: not audited.
- Not read in full: every product Hono route (I sampled the middleware, error handlers and body parsing), every migration's SQL (I counted `ENABLE`/`FORCE`/`CREATE POLICY` and read the helpers), all 26k lines of product frontend (I sampled boundaries and risky APIs).

### Confidence per section
Next.js medium-high; React medium (sampled); Hono medium; Zod high; Drizzle medium (RC version, docs unversioned); PostgreSQL medium-high on design, low on runtime; Auth.js medium (docs from main, installed is a beta); Anthropic/Agent SDK medium (docs unversioned); TypeScript low (docs not captured); pnpm high; Vitest medium; Playwright high; Biome high; Docker medium; Swift medium-low (Apple docs not captured; only the filed skill); Tesseract.js medium-low (docs from master, installed 7.0.0).

## 2. Provenance table

Captures live in `/private/tmp/claude-501/-Users-desoleary-dev-omnitech-solutions-omnitech-active-session/a2423c52-6dea-4b0c-8098-9a6f1c9780d9/scratchpad/docs-audit/` (outside the repo). Capture date for all rows: 2026-10-05. Installed versions from `pnpm-lock.yaml` / `node_modules/.pnpm`.

| # | Technology | Installed | Source | Branch/tag | Commit SHA or fetch | How captured | Reused filed source |
|---|---|---|---|---|---|---|---|
| P1 | Next.js App Router docs | next 16.2.11 | https://github.com/vercel/next.js (`docs/`) | tag `v16.2.11` | `9beca0821cf4606ae33466ed6f4fc75f2887a4da` | sparse shallow clone, re-checked out at the tag | no |
| P2 | Vercel React best practices + composition patterns | react 19.3.0 | https://github.com/vercel-labs/agent-skills (`skills/react-best-practices`, `skills/composition-patterns`) | n/a | `063bee94c3f4df8453406c830b0a7df0f2860278` (per the filed PROVENANCE) | not re-captured | yes: `bionic/research/sources/vercel-react-best-practices.md`, `vercel-composition-patterns.md`, raw under `research/raw/2026-10-04/` |
| P3 | Swift concurrency skill | Swift 6 tools (Package.swift) | https://github.com/AvdLee/Swift-Concurrency-Agent-Skill (`skills/swift-concurrency`) | n/a | `d5770817d2622e1585b1f7eaebc791a9cb0959c8` (filed) | not re-captured | yes: `swift-concurrency-agent-skill.md` |
| P4 | Drizzle ORM + drizzle-kit (6 pages: schema, migrations, generate, migrate, RLS, transactions) | 1.0.0-rc.4 both | https://orm.drizzle.team/docs/... | n/a (unversioned site) | fetched 2026-10-05 by the filed capture | not re-captured | yes: six `drizzle-*.md` sources, raw under `research/raw/2026-10-05/`; version not matched (site unversioned, RC) |
| P5 | Hono docs | hono 4.12.31 (4.13.12 also present transitively) | https://github.com/honojs/website | `main` | `3504d40e5223a87cc3f2e0453a0a18af225ac0c5` (commit date 2026-10-04) | shallow clone | no; version NOT matched (website repo has no version tags) |
| P6 | Zod docs | zod 4.4.3 (4.6.5 also present transitively) | https://github.com/colinhacks/zod (`packages/docs`) | tag `v4.4.3` | `1fb56a5c18c27102dbc92260a4007c7732a0ccca` | shallow clone at the tag | no |
| P7 | Auth.js docs | next-auth 5.0.0-beta.30 | https://github.com/nextauthjs/next-auth (`docs/`) | `main` | `a1a16a5a7780488c7449feece410033f445d0b31` (2026-07-22) | shallow clone | no; version NOT matched (main, newer than beta.30) |
| P8 | Playwright docs | @playwright/test 1.63.0 | https://github.com/microsoft/playwright (`docs/src`) | tag `v1.63.0` | `1b025d7e20a026371cd5f98ba0cdce48892737c8` | shallow clone at the tag | no |
| P9 | Vitest docs | vitest 4.1.10 | https://github.com/vitest-dev/vitest (`docs`) | tag `v4.1.10` | `db616d227b6e0cb07a94f5d1bba262ee95db7e46` | shallow clone at the tag; only `projects` and `unstubEnvs` pages read | no |
| P10 | pnpm docs | pnpm 10.33.3 | https://github.com/pnpm/pnpm.io (`versioned_docs/version-10.x`) | `main` | `84b885fd8d5213ab38117a52f3fbceee026bc5bc` | shallow clone; 10.x folder used | no; major matched, patch not |
| P11 | Biome docs | @biomejs/biome 2.5.5 | https://github.com/biomejs/website (`src/content/docs/en`) | `main` | `e8e3130b65f1c355bbacbfc899aaf2dd6b87ce64` (2026-10-05) | shallow clone | no; version NOT matched (main) |
| P12 | PostgreSQL 17 row security chapter | postgres:17-alpine (compose.yaml:5) | https://www.postgresql.org/docs/17/ddl-rowsecurity.html | docs 17 | WebFetch 2026-10-05 | WebFetch summary | no |
| P13 | node-postgres pool API | pg 8.23.1 | https://node-postgres.com/apis/pool | unversioned | WebFetch 2026-10-05 | WebFetch summary | no |
| P14 | Docker port publishing | Docker 29.1.3 (local) | https://docs.docker.com/engine/network/port-publishing/ | current | WebFetch 2026-10-05 | WebFetch summary | no |
| P15 | Claude Agent SDK TypeScript reference | @anthropic-ai/claude-agent-sdk 0.3.220 | https://code.claude.com/docs/en/agent-sdk/typescript (redirect target of docs.claude.com) | unversioned | WebFetch 2026-10-05 | WebFetch summary | no; version NOT matched |
| P16 | Anthropic structured outputs | @anthropic-ai/sdk 0.115.0 | https://platform.claude.com/docs/en/build-with-claude/structured-outputs | unversioned | WebFetch 2026-10-05 | WebFetch summary | no |
| P17 | Tesseract.js local install + API | tesseract.js 7.0.0 | https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md and `.../api.md` | `master` | WebFetch 2026-10-05 | WebFetch summaries | no; version NOT matched |

17 provenance rows. Fetched text was treated as data and is paraphrased below.

## 3. Summary matrix

Counts of findings by requirement level; status letters: C conforms, Dd deviates (documented), Du deviates (undocumented), U unverified. Total 84 findings.

| Technology | MUST (C/Dd/Du/U) | SHOULD (C/Dd/Du/U) | MAY (C/Dd/Du/U) |
|---|---|---|---|
| Next.js | 6 (6/0/0/0) | 6 (2/0/2/2) | 3 (1/0/2/0) |
| React | 1 (1/0/0/0) | 2 (2/0/0/0) | 1 (0/0/0/1) |
| Hono | 0 | 4 (1/0/3/0) | 1 (0/0/1/0) |
| Zod | 0 | 4 (3/0/1/0) | 0 |
| Drizzle | 1 (1/0/0/0) | 5 (4/0/0/1) | 0 |
| PostgreSQL | 3 (3/0/0/0) | 3 (1/0/1/1) | 2 (1/0/0/1) |
| Auth.js | 1 (1/0/0/0) | 4 (1/0/2/1) | 1 (0/0/0/1) |
| Anthropic SDK / Agent SDK | 2 (2/0/0/0) | 4 (1/0/1/2) | 1 (1/0/0/0) |
| TypeScript | 0 | 2 (0/0/0/2) | 0 |
| pnpm | 1 (1/0/0/0) | 2 (1/0/1/0) | 1 (0/0/0/1) |
| Vitest | 1 (1/0/0/0) | 2 (1/0/1/0) | 0 |
| Playwright | 0 | 4 (2/1/1/0) | 1 (1/0/0/0) |
| Biome | 0 | 3 (1/0/2/0) | 0 |
| Docker/compose | 0 | 2 (1/0/1/0) | 2 (0/0/1/1) |
| Swift/WKWebView/SCK/Vision | 1 (0/0/0/1) | 3 (0/2/1/0) | 1 (0/0/0/1) |
| Tesseract.js | 1 (1/0/0/0) | 2 (1/0/0/1) | 0 |
| **Total** | **18 (17/0/0/1)** | **52 (22/3/17/10)** | **14 (4/0/4/6)** |

Headline: no MUST-level deviation found against the captured docs. The undocumented deviations are SHOULD/MAY (security headers, owner-role split, optional token gate, structured outputs, lint preset, CI for e2e, loopback binding).

Not covered by the matrix: technologies in the scope list that are used but have no row because no usable doc was captured (`ws`, `pg-boss`, Mermaid, CodeMirror, shiki, docx-preview, jszip, pptxgenjs, pdf-lib, esbuild, turbo, lefthook). Turbo (`turbo.json`) and lefthook were read but not compared with docs.

## 4. Per-technology findings

Format: ID, level, what the doc says (source row), what the repo does (file:line), status, impact, recommended action. "Owner" = needs an owner decision or ADR (AGENTS.md rule 1 simplicity; 1,000-changed-line scope checkpoint noted where relevant).

### 4.1 Next.js App Router (apps/web) — P1

**Architecture & boundaries**

| ID | Lvl | Doc (P1) | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| NX-ARC-01 | MUST | `register()` in `instrumentation` runs once per server start and must finish before requests are served | `apps/web/instrumentation.ts:3-6` guards on `NEXT_RUNTIME === "nodejs"` and imports `instrumentation-node.ts`, which awaits role and migration checks (`instrumentation-node.ts:17-19`) and rethrows the two fatal errors (`:20-27`) | CONFORMS | fail-closed start is intended |
| NX-ARC-03 | MUST | Instrumentation file sits at the project root, or inside `src/` only when `app/` is inside `src/` | `apps/web/instrumentation.ts` at root; `app/` is at `apps/web/app` (an unrelated `src/platform` folder exists) | CONFORMS | none |
| NX-ARC-02 | SHOULD | Keep `"use client"` boundaries deliberate; Server Components by default | Shell layouts/pages are server components (`app/t/[tenantSlug]/layout.tsx`); `platform-shell.tsx:1` and the products' frontends are client components behind one catch-all page (`.../[[...productPath]]/page.tsx`) per ADR-0004/0017 | CONFORMS | none |

**Security**

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| NX-SEC-03 | MUST | `.env.*` gitignored; only public values use `NEXT_PUBLIC_` (production checklist) | `.gitignore:9-10` ignores `.env`; `NEXT_PUBLIC_*` limited to build id, on-device model digest and a dev flag (`next.config.ts:20`, `src/platform/products.ts:41`, `scripts/dev.mjs:16`) | CONFORMS | none |
| NX-SEC-05 | MUST | Each Server Action must verify the caller itself | the only server actions are the three sign-in forms (`app/sign-in/page.tsx:12-31`), public by design | CONFORMS | none |
| NX-SEC-04 | SHOULD | Zero-trust: do data access in a `server-only` Data Access Layer, only that layer reads `process.env`, consider tainting | no `server-only`/taint use anywhere (grep over apps, packages, products); 43 `process.env[...]` reads in `apps/web/app`, `apps/web/src`, product frontends outside a DAL | DEVIATES-undocumented | Low-medium: leak guard relies on package boundaries and the `env-docs` test, not the framework marker. Action: add `import "server-only"` to server-only entrypoints (S); owner decision whether tainting is worth it |
| NX-SEC-01 | MAY | "Consider" a Content-Security-Policy (nonce-based needs dynamic rendering) | no CSP or security headers in `next.config.ts`; the only CSPs are on a sandboxed preview frame (`document-preview.tsx:15`) and one route (`live-session/routes.ts:470`), `nosniff` once (`documents/api.ts:1367`) | DEVIATES-undocumented | Medium for a page that holds live interview content. Action: owner decision; a static header set (frame-ancestors, nosniff, referrer-policy) is S, a nonce CSP is M and forces dynamic rendering (already the case for the shell) |
| NX-SEC-02 | MAY | `poweredByHeader: false` opts out of `x-powered-by` | not set (`next.config.ts`) | DEVIATES-undocumented | Low. S |

**Performance & caching**

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| NX-PER-01 | SHOULD | Request-time APIs make the route dynamic; use intentionally; route handlers are not cached unless opted in | API catch-all is `dynamic = "force-dynamic"`, `runtime = "nodejs"` (`app/api/[[...route]]/route.ts:3-4`); per-request membership read deduped with React `cache` (`src/platform/context.ts:70-73`) | CONFORMS | none |

**Error handling & observability**

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| NX-ERR-02 | MUST | `register` rejects block start | see NX-ARC-01; startup refuses a bypass-RLS role or mismatched migrations | CONFORMS | none |
| NX-ERR-01 | SHOULD | Add custom error pages; `app/global-error.tsx` and `global-not-found.tsx` for consistent fallback | none of `error.tsx`, `not-found.tsx`, `global-error.tsx`, `loading.tsx` exist under `apps/web/app` (find) | DEVIATES-undocumented | Low-medium: uncaught render error shows the framework default. Action: one `global-error.tsx` with a fixed message (S); never include error text (rule 8) |
| NX-ERR-03 | SHOULD | On SIGTERM/SIGINT Next finishes in-flight requests and `after()` work before exit | `instrumentation-node.ts:31-33` adds its own `process.once` listeners to abort workers | UNVERIFIED | Whether this delays or pre-empts Next's own shutdown was not tested. Action: verify under `next start` (S) |

**Build & deploy**

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| NX-BLD-03 | MUST | v16: `middleware` renamed `proxy`; `next lint` removed | no middleware/proxy file; lint is Biome (`apps/web/package.json` `lint`) | CONFORMS | none |
| NX-BLD-01 | SHOULD | Multi-instance hosting: same build for all instances; shared `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | single local process: `next start --hostname 127.0.0.1` (`apps/web/package.json`); build id from git (`next.config.ts:5-18`) | UNVERIFIED | No deployment target exists in the repo (no Dockerfile for web or worker), so multi-instance behaviour is moot today. Action: none until a hosted target is chosen (owner) |
| NX-BLD-02 | MAY | `output: "standalone"` is optional; `next start` is supported | not used | CONFORMS | none |

### 4.2 React (products/*/src/frontend) — P2, P1

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| RE-SEC-01 | MUST (inferred) | Untrusted markup must not be injected unsanitised | 3 `dangerouslySetInnerHTML` (`markdown-content.tsx:223,296,361`): Mermaid with `securityLevel: "strict"` (`:38`), shiki output; uploaded documents render in a script-less sandboxed same-origin frame with a no-network CSP (`document-preview.tsx:15,252`) | CONFORMS | Mermaid docs not captured; strictness is the library's own claim (UNVERIFIED beyond that) |
| RE-PER-01 | SHOULD | Bundle size and waterfalls are the top priorities; lazy-load heavy code | `mermaid`, `docx-preview`, shiki grammars and `tesseract.js` are dynamic imports (`markdown-content.tsx:33`, `document-preview.tsx:165`, `shiki-highlighter.ts:7-45`, `wasm-recognizer.ts:~58`); studio route is `lazy` (`studio-route.tsx:12`) | CONFORMS | none |
| RE-ARC-01 | SHOULD | Lift state into providers; explicit variants over boolean props | contexts `StudioContext` (`studio/context.ts:56`), `HandsFreeContext` (`live-session-view.tsx:156`) | CONFORMS | Component-level composition audit (e.g. 1,099-line `document-editor.tsx`) not done |
| RE-PER-02 | MAY | Stable keys (React, inferred) | `key={index}` in 5 static-looking lists (`answer-body.tsx:33`, `claim-chips.tsx:98`, `coding-panel.tsx:97`, `assistant-change.tsx:40`, `questions-card.tsx:44`) | UNVERIFIED | Fine if the lists never reorder; not checked |

### 4.3 Hono (product backends) — P5 (version not matched)

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| HO-ARC-01 | SHOULD | Write handlers after path definitions; compose with `app.route`, no controller classes | root app mounts platform, product and agent routers with `route()` (`apps/web/src/platform/api.ts:11-44`) | CONFORMS | none |
| HO-ERR-01 | SHOULD | `app.onError` handles uncaught errors with a custom response | interview sub-apps have it (`api.ts:938`, `studio/host.ts:187`, `live-session/routes.ts:187`, `plan/api.ts:78`); presentation and agent API use per-handler try/catch; `platform-api` preferences route parses JSON unguarded (`packages/platform-api/src/router.ts:71`) and the root app has no `onError` | DEVIATES-undocumented | Low: malformed JSON on `PUT /api/platform/v1/preferences` gives a default 500. S: add one `onError` on the root app returning a fixed body |
| HO-SEC-01 | SHOULD (inferred) | The `csrf` middleware checks Origin/Sec-Fetch-Site for form-type content types (including `text/plain`) | handlers call `req.json()` regardless of content type; hand-rolled checks exist only in `live-session/routes.ts:338-348` and the `/api/v1` gate (`api.ts:214-218`); Auth.js and handoff cookies are SameSite=Lax (`native-auth/redeem/route.ts:49-55`) | DEVIATES-undocumented | Low-medium, mitigated by Lax cookies. Action: one shared origin guard on mutating `/api/*` (S-M); owner decides scope |
| HO-SEC-02 | SHOULD (inferred) | `bearerAuth` is the documented token gate | `authenticate` (`products/interview/src/backend/api.ts:211-233`) allows every request when `INTERVIEW_API_TOKEN` is unset, treats the client-supplied `Sec-Fetch-Site`/`Origin` as proof of same-origin, and compares the bearer with `!==`; constant-time compare is used elsewhere (`platform-integrations/src/oauth.ts`, `native-handoff.ts`) | DEVIATES-undocumented | Medium for the legacy `/api/v1` surface; tenant scope still resolves separately (`interview-backend.ts:238-244`). Matches known audit L2 items (`bionic/inbox/redesign/audit/L2-backend.md`). Action: owner decision on retiring `/api/v1` vs hardening (M) |
| HO-SEC-03 | MAY | `requestId` middleware bounds the id length (default 255) | `x-request-id` from the client is echoed unbounded (`api.ts:284-291`) | DEVIATES-undocumented | Low. S |

### 4.4 Zod — P6 (v4.4.3 matched)

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| ZD-DEP-01 | SHOULD | Stay on one 4.x instance (instanceof across copies fails; inferred) | catalog pins `zod: 4.4.3` with a stated reason (`pnpm-workspace.yaml:20-21`: 4.6+ JSON-Schema output rejected by the assistant's ajv; reason not verified, 4.6 docs not captured); a second copy 4.6.5 exists via the Anthropic SDK peer but repo code imports one (`from "zod"` x41 resolves via catalog) | CONFORMS | `instanceof z.ZodError` (`plan/api.ts:79`) is safe only while one copy parses |
| ZD-ARC-01 | SHOULD | Method forms `z.string().email()/uuid()/url()` are deprecated for `z.email()/z.uuid()/z.url()` (changelog) | 19 uses (15 `.uuid()`, 3 `.url()`, 1 `.email()`), e.g. `products/presentation/src/backend/api.ts:26,34,40` | DEVIATES-undocumented | Low: still works in 4.x. S codemod; do it with the next Zod bump |
| ZD-ERR-01 | SHOULD | `ZodError.format()/flatten()` deprecated for `z.treeifyError` | 0 uses | CONFORMS | none |
| ZD-ARC-03 | SHOULD | Native `z.toJSONSchema` replaces `zod-to-json-schema` | `z.toJSONSchema` used (`active-session-contracts/src/wire-schema.ts:33`, `interview/.../structured.ts:21`); no `zod-to-json-schema` | CONFORMS | none |

### 4.5 Drizzle ORM and drizzle-kit — P4 (filed; RC, site unversioned)

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| DR-DAT-01 | MUST (inferred) | Keep a reviewable migration history; generate SQL and apply it (options 3/4), not `push` | `db:generate` = `drizzle-kit generate` + name writer (`packages/database/package.json`); no `push`; 25 migration folders with `migration.sql` + `snapshot.json` | CONFORMS | none |
| DR-DAT-02 | SHOULD | Policies via `pgPolicy`/`withRLS`; page does not cover `FORCE` | schemas use `withRLS` + `tenantPolicy` (`conventions.ts:42-50`; `interview/.../schema.ts:84`); `FORCE` is added by custom migrations (67 `FORCE ROW LEVEL SECURITY` vs 61 `ENABLE` and 106 `CREATE POLICY` across `packages/database/drizzle/*/migration.sql`) per ADR-0005 d5 | CONFORMS | Counts only; a table-by-table check needs a DB (the invariant `tenant-owned-tables-force-rls` records pass, 2026-10-02) |
| DR-DAT-03 | SHOULD | drizzle-kit does not manage roles unless `entities.roles` is enabled | role is created outside Drizzle (`docker/postgres/app-role.sql:4`); no `pgRole` | CONFORMS | none |
| DR-DAT-04 | SHOULD | Runtime migrator and kit share the history table | `migrate.ts:48-52` and `drizzle.config.ts:21` both use schema `drizzle`, table `__drizzle_migrations`; migrations are a deploy step, not boot (`migration-check.ts:4-9`) | CONFORMS | none |
| DR-ARC-01 | SHOULD | Nested `tx.transaction` creates a savepoint | `withTenant` hands out Drizzle's own transaction and says so (`with-tenant.ts:15-19`) | CONFORMS | none |
| DR-DEP-01 | SHOULD | Docs show the current API; the RC pin is exact | `1.0.0-rc.4` hard-pinned in three package.json (`packages/database`, `products/interview`, `products/presentation`), not in the catalog; only six doc pages cross-checked | UNVERIFIED | API drift between RC and the unversioned docs is possible. Action: move to the catalog (S); confirm APIs against `node_modules` before copying examples (already the reference's advice) |

### 4.6 PostgreSQL 17 (RLS, roles, schemas, grants) — P12

**Security**

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| PG-SEC-01 | MUST | Superusers and `BYPASSRLS` roles always bypass RLS | handle refuses such a role before any query (`packages/database/src/connection.ts:36-41,109-141`), startup check (`instrumentation-node.ts:17`), role created `NOSUPERUSER NOBYPASSRLS` (`app-role.sql:4`), fixed refusal text | CONFORMS | none |
| PG-SEC-02 | MUST | Table owners bypass RLS unless `FORCE ROW LEVEL SECURITY` | forced in migrations (counts in DR-DAT-02) | CONFORMS | runtime proof is in DB-backed suites I did not run |
| PG-SEC-04 | MUST (inferred) | Settings must not leak across pooled sessions | `set_config(..., true)` inside a transaction only (`with-tenant.ts:34-43`, `connection.ts:140-160`) | CONFORMS | none |
| PG-SEC-03 | SHOULD | FK, PK and unique checks bypass row security (covert channel) | composite `(tenant_id, id)` FKs plus index (`conventions.ts:52-73`); ADR-0005 d3 | CONFORMS | none |
| PG-SEC-05 | SHOULD (inferred, defence in depth) | Only the owner can disable RLS, drop policies or alter FORCE | the runtime role owns the database and schemas (`app-role.sql:1-4`) and the same connection runs migrations (`migrate.ts:44-52`), so a compromised app or injected DDL can disable its own RLS | DEVIATES-undocumented | Medium. ADR-0005 d4 requires a non-superuser, non-bypass role but is silent on ownership. Action: owner decision + ADR for a migrator/owner role and a runtime role with DML grants only (M; likely under the 1,000-line checkpoint but adds a role to compose bootstrap, so a scope checkpoint per rule 1) |

**Data & migrations / other**

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| PG-DAT-01 | SHOULD | Policies that sub-SELECT other tables can race and leak | `tenantPolicy`/`actorPredicate` are pure column=setting predicates (`conventions.ts:19-40`); named lookup policies (`share_token_lookup`, `agent_worker_*`, `catalog_in_tenant`) not read | UNVERIFIED | Read those policy bodies before claiming. S |
| PG-ERR-01 | MAY | `row_security = off` makes backups fail instead of silently filtering | no backup procedure in repo | UNVERIFIED | none |
| PG-DEP-01 | MAY | Match docs to server version | `postgres:17-alpine` (`compose.yaml:5`), docs 17 used; minor floats | CONFORMS | none |

### 4.7 Auth.js (login) — P7 (version not matched), P1

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| AU-SEC-01 | MUST | `AUTH_SECRET` is the one strictly required variable; 32+ random chars | production: no fallback, secret undefined when unset (`apps/web/auth.ts:33-37`); non-production falls back to a fixed string committed in the repo | CONFORMS | A staging host that is not `NODE_ENV=production` would sign sessions with a public secret. Action: S, refuse the fallback unless `FAKE_AUTH_ENABLED` is set |
| AU-ARC-01 | SHOULD | Login identity and provider authorisation are separate concerns | integrations use their own signed-state OAuth and an encrypted vault (`app/api/integrations/[provider]/callback/route.ts:35-108`), not login tokens | CONFORMS | ADR-0006 is Proposed |
| AU-SEC-02 | SHOULD (inferred; Credentials is for custom checks) | Credentials provider needs real verification logic | passwordless `local` provider registered on `FAKE_AUTH_ENABLED` alone (`auth.ts:10-22`), sign-in button likewise (`app/sign-in/page.tsx:26`), whereas context and products add `NODE_ENV !== "production"` (`context.ts:76-78`, `products.ts:49-50`) | DEVIATES-undocumented | Medium-high if the flag leaks to a hosted build; session would still need DB membership, which limits harm. Same finding as audit L2-06. Action: one `fakeAuthEnabled()` used by all four sites (S, no owner decision) |
| AU-SEC-03 | SHOULD | `trustHost`/`AUTH_TRUST_HOST` only behind a trusted reverse proxy | `trustHost: true` unconditionally (`auth.ts:55`) with `next start --hostname 127.0.0.1` | DEVIATES-undocumented | Low-medium (Host-header poisoning of callback URLs if ever exposed). Action: env-driven (S) |
| AU-SEC-04 | SHOULD | Cookie name/salt must match what Auth.js reads | handoff mints a JWT with the cookie name as salt (`native-auth/redeem/route.ts:34-44`) and sets `secure` from the request protocol (`:32`); Auth.js docs captured do not cover `encode` salt; behind a TLS-terminating proxy `request.url` is http | UNVERIFIED | Verify with the real hosted topology before deploying (S) |
| AU-DEP-01 | MAY | v5 is beta | `next-auth` exact `5.0.0-beta.30`; docs from `main` | UNVERIFIED | Re-capture docs at the beta tag when upgrading |

### 4.8 Anthropic SDK and Claude Agent SDK — P15, P16

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| AN-ARC-01 | MUST | `tools` restricts the toolset; `allowedTools` only auto-approves; `settingSources` omitted loads user/project/local settings; `strictMcpConfig` ignores other MCP sources | `tools` and `allowedTools` both set, `permissionMode: "dontAsk"` for `approvalPolicy "never"`, `settingSources: []`, `strictMcpConfig: true`, `mcpServers: {}`, `plugins: []` (`packages/agent-runtime-claude/src/index.ts:392-408`) | CONFORMS | none |
| AN-SEC-01 | MUST (inferred, rule 7) | SDK subprocess inherits the host environment unless `env` is given | worker passes an allow-listed environment (`apps/agent-worker/src/main.ts:81-110`) | CONFORMS | none |
| AN-ERR-02 | SHOULD | Bound retries and time; typed API errors | `maxRetries: 2`, one deadline across retries, fixed failure texts, no body echoed (`ai-provider-anthropic/src/index.ts:19-96`) | CONFORMS | none |
| AN-ERR-01 | SHOULD | `default` permission mode prompts for unlisted tools | `permissionMode: "default"` when approval is not "never", with no permission callback (`index.ts:396-397`) | UNVERIFIED | Headless behaviour for a non-"never" profile not exercised. S: confirm no profile uses it |
| AN-ARC-02 | SHOULD | Structured outputs (`output_config.format` json_schema, or `zodOutputFormat`) are recommended over prompt-and-parse JSON | direct adapter builds JSON by prompt, parses, and retries once with a repair prompt (`ai-provider-anthropic/src/index.ts:154-182`) | DEVIATES-undocumented | Medium-low: extra latency and failure paths. The provider-neutral gateway (ADR-0007, Proposed) may justify it. Action: owner decision/ADR; M. Note the Agent SDK path already uses `outputFormat: json_schema` (`agent-runtime-claude/src/index.ts:412-419`) |
| AN-DEP-01 | SHOULD (inferred) | Doc lists supported models for structured output as Opus 5.5, Sonnet 5.5, Haiku 4.5 and newer | hard-coded defaults `claude-sonnet-4-6` (`apps/web/src/platform/ai.ts:293`), `claude-opus-4-6` (`ai-runtime/src/config.ts:191`) | UNVERIFIED | Deprecation dates not fetched; defaults age silently. Action: move defaults to config with a startup warning (S), owner picks models |
| AN-DEP-02 | MAY | n/a | two `@anthropic-ai/sdk` copies, 0.115.0 (direct) and 0.131.0 (via agent SDK) | CONFORMS | pre-1.0 caret pins minor only; note for upgrades |

### 4.9 TypeScript configuration — no doc captured

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| TS-DEV-01 | SHOULD (inferred) | Enable strictness | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` (`tsconfig.base.json`) | UNVERIFIED | Repo is stricter than default; no doc to cite |
| TS-BLD-01 | SHOULD (inferred) | Per-file transpilers (esbuild, Next, Vitest) want `isolatedModules`/`verbatimModuleSyntax` | neither is set in `tsconfig.base.json` or `apps/web/tsconfig.json` | UNVERIFIED | Next may add it at build; not checked. S: read after `next build` |

### 4.10 pnpm workspaces and catalog — P10 (10.x)

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| PN-SEC-01 | MUST (v10 default) | Dependency lifecycle scripts are off unless allowed; `allowBuilds` maps allow/deny | explicit denies for esbuild, sharp, tesseract.js, tldjs (`pnpm-workspace.yaml:7-11`) | CONFORMS | none |
| PN-BLD-01 | SHOULD | Pin `packageManager`; use `workspace:` and `engines` | `packageManager: pnpm@10.33.3`, `engines.node >=22` (`package.json:5-9`), `workspace:*` everywhere | CONFORMS | none |
| PN-DEP-01 | SHOULD | Catalog gives one version per dependency | catalog holds react, types, tsx, typescript, vitest, zod; but `hono ^4.12.8` is repeated in 3 manifests, `drizzle-orm` in 3, `esbuild` is `^0.27.0` (web, interview) and `^0.28.0` (worker, gateway), so two esbuilds | DEVIATES-undocumented | Low. S: move hono, drizzle, esbuild to the catalog |
| PN-DEP-02 | MAY | `blockExoticSubdeps` forbids tarball sources for transitive deps | 17 `file:` vendor tarball specifiers via root overrides (`package.json` `pnpm.overrides`; `vendor/` 1.1 MB, 10 tarballs) | UNVERIFIED | Provenance/refresh process for the vendored tarballs is not documented in the places I read. Owner question (section 7) |

### 4.11 Vitest — P9

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| VT-TST-01 | MUST | `workspace` is deprecated since 3.2; use `projects` | `test.projects` (`vitest.config.ts:40`) | CONFORMS | none |
| VT-TST-03 | SHOULD | Separate environments per project | node, docker, integration, react (jsdom), web projects (`vitest.config.ts:40-115`); Docker tests excluded from `test:no-docker` | CONFORMS | matches Engineering contract |
| VT-TST-02 | SHOULD | `vi.stubEnv` values persist unless `unstubEnvs` or `vi.unstubAllEnvs()` | 18 of 19 stubbing files call `unstubAllEnvs`; `scripts/rls-role-guard.test.ts` does not; no global `unstubEnvs` | DEVIATES-undocumented | Low. S: set `unstubEnvs: true` in the root and web configs |

### 4.12 Playwright (e2e/live-session) — P8 (v1.63.0 matched)

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| PW-TST-01 | SHOULD | Prefer user-facing locators over CSS | 872 `getBy*` uses vs 43 `.locator(` in `e2e/live-session/src` and `tests` | CONFORMS | none |
| PW-TST-02 | SHOULD | Web-first assertions; no manual `isVisible()` asserts; avoid fixed sleeps | 0 `waitForTimeout`; 2 `isVisible()` calls | CONFORMS | review the 2 (S) |
| PW-TST-03 | SHOULD | Tests isolated and independent | `workers: 1`, `fullyParallel: false`, one shared stack and database; specs each start a session (`playwright.config.ts:40-46`) | DEVIATES-documented (config comment only, no ADR) | Order coupling risk is low while each spec makes its own session |
| PW-TST-04 | SHOULD | Run the suite on each commit and pull request in CI | no `.github`/CI file; `pnpm verify` runs lint, format, typecheck, coverage, build, native check but not `test:browser` (`package.json` `verify`); lefthook runs `verify` at pre-push only | DEVIATES-undocumented | Medium: OBJ-10 says every interaction is proven, yet nothing runs the proof automatically. Action: owner decision (cost vs gate); M |
| PW-TST-05 | MAY | Traces on first retry in CI | `retries: 0`, `trace: "retain-on-failure"`, `forbidOnly: true` | CONFORMS | none |

### 4.13 Biome — P11 (version not matched)

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| BM-DEV-01 | SHOULD | `linter.rules.preset` defaults to the recommended set; `none` is allowed and explicit rules still apply | `preset: "none"` with only four rules on: `noUnusedImports`, `noUndeclaredDependencies`, `noPrivateImports`, `noRestrictedImports` (`biome.json:30-48`) | DEVIATES-undocumented (known gap only in `bionic/inbox/redesign/audit/L6-contracts-tooling.md` L6-04) | Medium: lint catches almost no correctness issues. Action: owner decision; enable recommended in one commit and fix or suppress findings (M, may pass 1,000 lines, so checkpoint) |
| BM-DEV-02 | SHOULD | Next production checklist advises accessibility linting; Playwright advises a no-floating-promises rule; Biome ships `noFloatingPromises` | neither the a11y group nor `noFloatingPromises` is enabled | DEVIATES-undocumented | Low-medium for a UI-heavy app. S per rule |
| BM-DEV-03 | SHOULD | Format gate | `biome format . --error-on-warnings` in `verify`, pre-commit hook (`lefthook.yml`), `$schema` equals installed 2.5.5 | CONFORMS | none |

### 4.14 Docker and compose — P14 (others inferred)

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| DK-SEC-01 | SHOULD | Published ports bind all host interfaces unless an IP is given | `"54320:5432"` (`compose.yaml:11`) with superuser password `postgres` (`:7-8`) and app role password `omnitech` (`app-role.sql:4`) | DEVIATES-undocumented | Medium for a candidate who runs the studio on a laptop on shared networks. Action: `127.0.0.1:54320:5432` (S, no owner decision) |
| DK-SEC-02 | SHOULD (inferred; Docker security doc not captured) | Run untrusted code with no network, resource caps, non-root, read-only rootfs, dropped capabilities | `--network none`, memory, swap, cpus, pids, `--user 65534`, `--read-only`, tmpfs `noexec`, `no-new-privileges`, `--cap-drop ALL`, `--pull=never` (`packages/code-runner/src/index.ts:221-240,436-441`) | CONFORMS | none |
| DK-BLD-01 | MAY | Pin base images | floating tags: `node:22-alpine`, `php:8.3-cli-alpine`, `ruby:3.4-alpine`, `composer:2`, `postgres:17-alpine` | DEVIATES-undocumented | Low. Pin digests if reproducibility matters (S) |
| DK-DAT-01 | MAY | Image init scripts run only on an empty data directory | `app-role.sql` is mounted into `docker-entrypoint-initdb.d` (`compose.yaml:14`); Docker Hub page not captured | UNVERIFIED | A changed role script will not apply to an existing volume |

### 4.15 Swift, WKWebView, ScreenCaptureKit, Vision — P3 (Apple docs not captured)

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| SW-SEC-01 | MUST (inferred) | Restrict what a WKWebView navigates to and which origins get media capture (Apple docs not captured) | navigation allow-listed to Studio origin, others open externally (`StudioWebView.swift:23-61`); camera/mic granted only to a main-frame Studio origin (`:73-85`); message handler in the page world with host-call decoding | UNVERIFIED | Code matches ADR-0019/0020 intent; no Apple doc to cite |
| SW-ARC-01 | SHOULD | Read the Swift language mode first; prefer Swift 6 isolation | core and companion are Swift 6 (`swiftLanguageModes: [.v6]`), the shell executable target is `.swiftLanguageMode(.v5)` with a stated reason, AppKit/WebKit/Carbon main-thread APIs (`apps/studio-shell/Package.swift`) | DEVIATES-documented (Package.swift comment; ADR-0019 does not cover language mode) | Low |
| SW-TST-01 | SHOULD (inferred) | Use the standard test framework | executable test harnesses because the Command Line Tools ship neither XCTest nor Swift Testing (both Package.swift headers); `verify-native.mjs` in `verify` | DEVIATES-documented (comment) | Low |
| SW-ARC-02 | SHOULD | Each `@unchecked Sendable` needs a written safety invariant and a removal plan | 10 uses: `TextRecognition.swift:144`, `VisionTextObserver.swift:61`, `SystemCompanionRun.swift:13,155`, `ScreenKitSource.swift:14`, `MicrophoneCapture.swift:10`, `SystemCaptureSources.swift:24`, `ShareableContentFetch.swift:17,43`, `OnDeviceSpeech.swift:68`; about six state an invariant, the `ShareableContentFetch` boxes, `EventBox` and `EngineSources` only partly, none has a removal plan | DEVIATES-undocumented | Low-medium (crash history noted in `ShareableContentFetch.swift:7,49`). Action: one-line invariant per site (S) |
| SW-SEC-02 | MAY | Ad-hoc signing resets TCC grants on rebuild (inferred) | `codesign --force --sign -` (`studio-shell/scripts/bundle-app.sh:68`) | UNVERIFIED | Local-dev nuisance only |

### 4.16 Tesseract.js (OCR assets) — P17 (master docs vs installed 7.0.0)

| ID | Lvl | Doc | Repo | Status | Impact / Action |
|---|---|---|---|---|---|
| TE-ARC-01 | MUST | Offline use needs `workerPath`, `corePath`, `langPath`; omitting `langPath` falls back to a CDN | all three set to own-origin `/ocr/...`, `cacheMethod: "none"` (`wasm-recognizer.ts:62-69`); assets copied at build (`apps/web/scripts/copy-ocr-assets.mjs`); data checked before use | CONFORMS | none |
| TE-ERR-01 | SHOULD | Terminate workers; handle worker errors | idle terminate, budget, `errorHandler` (`wasm-recognizer.ts:8-10,70-77`) | CONFORMS | none |
| TE-ARC-02 | SHOULD | `corePath` as a directory holding the core variants | directory used; only the three LSTM cores are copied (`copy-ocr-assets.mjs:36-41`) with engine mode 1; doc names a different four-file list | UNVERIFIED | Fine for LSTM-only; doc for 7.0.0 not matched. S: check the 7.0.0 README |

## 5. Cross-cutting

1. **Rule authority vs ADR status.** AGENTS.md architecture rules 2-7 cite ADR-0004 to -0007, all still Proposed. "Repo rules win" is therefore resting on proposed decisions; the Accept step is owed (owner).
2. **Next.js vs product architecture.** Next advises Server Components and thin client boundaries; products are client-heavy SPAs behind one catch-all page. Justified by ADR-0004/0017/0019 (also Proposed or Accepted mix). No defect.
3. **Next route handlers vs Hono.** Next suggests one handler per route; the repo mounts a whole Hono app under `app/api/[[...route]]` (`route.ts:7-17`). Fine, but it moves error handling, CSRF and headers from Next features to Hono features (HO-ERR-01, HO-SEC-01, NX-SEC-01).
4. **Anthropic structured outputs vs provider neutrality.** The vendor recommends native schema output; ADR-0007's gateway keeps adapters thin and provider-neutral, so JSON-by-prompt stays (AN-ARC-02). Owner trade-off.
5. **Drizzle RLS page vs PostgreSQL vs ADR-0005.** The Drizzle page omits FORCE; PostgreSQL says the owner bypasses unless forced; ADR-0005 d3 forces it; but d4 leaves the owner and runtime role as one (PG-SEC-05).
6. **Zod pin vs Anthropic SDK peer.** Pin to 4.4.3 for an ajv incompatibility while the Anthropic SDK resolves 4.6.5. Safe today; fragile for `instanceof` (ZD-DEP-01).
7. **Lint stance vs other docs.** Next and Playwright both lean on lint rules (a11y, floating promises) that the Biome `preset: none` choice switches off (BM-DEV-01/02).
8. **Stale invariant records.** `product-routes-resolve-membership-first` and `tenant-drizzle-handle-only-via-with-tenant` show `last_result: fail` dated 2026-10-02 in `bionic/invariants/`; newer guard tests (`scripts/tenant-context-boundary.test.ts`, `route-classification.test.ts`) exist. I did not run them, so the current state is UNVERIFIED; the records should be refreshed.
9. **Fake auth spans three technologies.** Auth.js (provider), Next (public sign-in form) and AGENTS rule 6 ("login identities prove who the user is") disagree about a passwordless provider; only context code guards production (AU-SEC-02).
10. **Docs version mismatch risk.** Rows P5, P7, P10, P11, P15, P17 are not version-matched; Drizzle and the Agent SDK sites are unversioned. Findings that hinge on those docs are SHOULD/MAY by design.

## 6. Prioritised action list

No MUST-level deviation was found, so ranking is by impact among SHOULD/MAY. No fixes were applied.

| Rank | ID | Action | Effort | Owner decision / ADR |
|---|---|---|---|---|
| 1 | AU-SEC-02 | one `fakeAuthEnabled()` guarded by `NODE_ENV` for provider, button, context, products | S | no |
| 2 | DK-SEC-01 | bind compose Postgres to `127.0.0.1` | S | no |
| 3 | PG-SEC-05 | split migration/owner role from runtime role | M | yes (ADR; scope checkpoint, rule 1) |
| 4 | HO-SEC-02 | decide `/api/v1` fate; make the token gate mandatory and constant-time, stop trusting `Sec-Fetch-Site` alone | M | yes |
| 5 | NX-SEC-01/02 | add baseline security headers (frame-ancestors, nosniff, referrer-policy), consider CSP, disable `x-powered-by` | S-M | yes for CSP |
| 6 | PW-TST-04 | run `test:browser` automatically (CI or pre-push) | M | yes |
| 7 | BM-DEV-01/02 | enable recommended preset, a11y and `noFloatingPromises` | M | yes (may exceed 1,000 lines) |
| 8 | AN-ARC-02 / AN-DEP-01 | native structured outputs for Anthropic; config-only model defaults | M / S | yes |
| 9 | AU-SEC-03 / AU-SEC-04 | env-driven `trustHost`; verify handoff cookie behind TLS proxy | S | no |
| 10 | SW-ARC-02 | write the invariant at each `@unchecked Sendable` | S | no |
| 11 | NX-ERR-01, HO-ERR-01, HO-SEC-01 | `global-error.tsx`, root `onError`, shared origin guard | S each | no / scope for HO-SEC-01 |
| 12 | PN-DEP-01, DR-DEP-01, ZD-ARC-01, VT-TST-02 | catalog hono/drizzle/esbuild; `z.uuid()` forms; `unstubEnvs` | S | no |

## 7. Open questions for the owner

1. Should ADR-0004/0005/0006/0007 be accepted now, so AGENTS.md rules rest on accepted decisions?
2. Is a separate owner/migrator role acceptable (PG-SEC-05), or is the single role a deliberate simplicity choice under ADR-0002?
3. Is the `/api/v1` legacy surface still needed, and by whom (CLI, `interview-api-client`)? Should its token be mandatory?
4. Where will the hosted app run (reverse proxy, TLS, multiple instances)? That decides `trustHost`, cookie `secure`, build id, encryption key and standalone output (NX-BLD-01, AU-SEC-03/04).
5. What is the build and refresh process for the `vendor/` tarballs (assistant packages, UI components), and is a provenance note wanted (PN-DEP-02)?
6. Should e2e (OBJ-10) gate commits, and where does CI run (PW-TST-04)?
7. Is the Biome `preset: none` choice deliberate, or the staging step of the L6-04 plan?
8. Which Claude models are the intended defaults (AN-DEP-01), and do you want native structured outputs for the direct adapter (AN-ARC-02)?
9. Are the two failing invariant records stale, and who refreshes `bionic/invariants/reconciliation.yml`?
10. Do you want the uncaptured docs added (TypeScript, Apple WebKit/ScreenCaptureKit/Vision, Mermaid, Docker Hub postgres, OAuth RFC 9700 for the integrations flow, which currently has no PKCE in `packages/platform-integrations/src`)?

---

## Lead review (2026-10-05, after the worker's report)

Author: the lead agent, reading the code directly at HEAD `2b0d19d` (the worker audited `3ae02b9`; no source files changed between them). This section is separate from the worker's analysis above so the two can be told apart. It is also model analysis, not a certification, and nothing was run: no database, browser, Docker or native app.

### What the lead re-verified (read in the code, with evidence)

| Worker finding | Lead result | Evidence read |
| --- | --- | --- |
| AU-SEC-02 passwordless `local` provider gated on the flag alone | **Confirmed, and worse than the worker stated.** `authorize` takes no credentials and always returns the fixed local user (id `00000000-0000-4000-8000-000000000001`, email `local@omnitech.test`). Only `context.ts` and `products.ts` also test `NODE_ENV !== "production"`; the provider (`auth.ts:10`) and the sign-in button (`sign-in/page.tsx:26`) do not. With the flag on in a production build, anyone can mint a session as that user; `context.ts` then resolves real membership, so the impact depends on whether that email exists as a member. `PLATFORM_BOOTSTRAP_EMAIL` defaults to the same address. | `apps/web/auth.ts:10-21`, `apps/web/src/platform/context.ts:76-78`, `apps/web/src/platform/products.ts:48-50` |
| HO-SEC-02 `/api/v1` token gate | **Confirmed, and the bypass is broader.** The gate is skipped when the token is unset; when it is set, a request is exempt if it carries `Sec-Fetch-Site: same-origin` or an `Origin` equal to its own URL. Both headers are set by the client, so any non-browser client can send them and skip the token entirely. The bearer comparison is a plain `!==`. | `products/interview/src/backend/api.ts:211-232` |
| DK-SEC-01 Postgres published on all interfaces with default passwords | **Confirmed.** `54320:5432` (no `127.0.0.1:` prefix), user and password `postgres`. | `compose.yaml:9-13` |
| NX-SEC-01/02 no security headers, `x-powered-by` sent | **Confirmed.** `next.config.ts` has no `headers()` and no `poweredByHeader: false`; there is no `middleware.ts` or `proxy.ts`. | `apps/web/next.config.ts` |
| PG-SEC-05 runtime role can alter its own RLS | **Plausible, not shown at runtime.** The role guard checks only superuser and BYPASSRLS, not table ownership; `pnpm dev` runs migrations and the app through the same `omnitech` URL, so that role owns the tables, and an owner can disable RLS or drop policies. Not exercised against a database. | `packages/database/src/connection.ts:148-170`, `scripts/dev.mjs` |
| PW-TST-04 e2e in no CI or `verify` | **Confirmed.** There is no `.github/workflows`; `pnpm verify` does not run Playwright; the only automated gate is the lefthook `pre-push` running `pnpm verify`. | `lefthook.yml`, `package.json` |
| BM-DEV-01 Biome `preset: none` | **Confirmed** (`"preset": "none"` with an explicit rule list). | `biome.json:31-33` |
| ADR-0004/5/6/7 still Proposed while AGENTS.md cites them | **Confirmed.** | `bionic/adrs/ADR-0004`..`0007` frontmatter |
| Two invariants with `last_result: fail` | **Confirmed** by file: `tenant-drizzle-handle-only-via-with-tenant.md`, `product-routes-resolve-membership-first.md`. Why they fail was not investigated. | `bionic/invariants/` |

Not re-verified by the lead (so still the worker's word only): the other ~75 findings, all provenance rows, the doc-version matching, and every UNVERIFIED item (including the WKWebView navigation allow-list, which needs Apple's docs).

### Re-ranked priorities (lead judgement)

1. **AU-SEC-02** (S): also gate the `local` provider and the sign-in button on `NODE_ENV !== "production"`, or refuse to start when `FAKE_AUTH_ENABLED=true` in production. Worth doing before any shared deployment; it is the only finding where a single environment mistake grants a session.
2. **HO-SEC-02** (S-M): do not treat client-supplied `Origin` / `Sec-Fetch-Site` as proof of identity for a non-browser caller; require the token for anything the browser flow does not authenticate by cookie, use a constant-time compare, and decide whether an unset token should mean open. Needs an owner decision (it changes the CLI contract).
3. **DK-SEC-01** (S): publish Postgres as `127.0.0.1:54320:5432`.
4. **NX-SEC-01/02** (S-M): `poweredByHeader: false` and a baseline header set; a CSP needs care because of the WKWebView host and the OCR worker.
5. **PW-TST-04** (M): there is no CI at all; the e2e suite (now 4 shards, about 6 minutes) is a candidate first job.
6. **PG-SEC-05** (M, needs an ADR): separate the migration/owner role from the runtime role.
7. **Cross-cutting** (S): accept or supersede ADR-0004 to 0007; find out why the two invariants fail.

### Findings the lead found this session that the audit does not contain

- `.env.example` shipped an active `AI_MODEL=gpt-5-mini`. Any of `AI_MODEL`, `OPENAI_MODEL`, `OPENAI_API_KEY`, `LM_STUDIO_MODEL` turns off `pnpm dev`'s LM Studio fallback (`scripts/local-model.mjs`), so a copy configured a hosted model with an empty key. **Fixed** in `47050af`.
- `pnpm dev` hardcodes `DATABASE_URL`, so the line in `.env.example` was misleading. **Documented** in `47050af`.
- The README documented `NEXT_PUBLIC_TERMINAL_GATEWAY_URL`, which no code reads. **Removed** in `47050af`.
- `e2e/live-session` `glass-clear` (WebKit) fails intermittently (2 of 4 runs, identical numbers each time). Cause not found. See `bionic/inbox/redesign/plan.md` 7.0y.
- The WebKit e2e project raised macOS's microphone dialog. **Fixed** in `3ae02b9`; see plan 7.0y.

### Honest limits of this review

The lead read about 10 code locations. A security-relevant claim here means "the code reads this way", not "this was exploited": none of the bypasses above was attempted.

### Addendum (2026-10-05, after the signed-out 404 fix)

AU-SEC-02 now has one more entry point to weigh: with `FAKE_AUTH_ENABLED=true` in a production build, `/api/native-auth/start` offers the same passwordless `local` provider to the native shell (`apps/web/src/platform/fake-auth.ts` `localSignInNeeded`, `apps/web/app/api/native-auth/start/route.ts`). It grants nothing the provider did not already grant through `/api/auth/callback/local`, and it is off whenever the flag is off. If AU-SEC-02 is fixed by refusing the flag in production, this entry point and the e2e harness (which runs a production build with the flag and signs in through `local` over HTTP) both need an explicit, separate switch instead.

