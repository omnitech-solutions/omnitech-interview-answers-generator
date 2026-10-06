# GOV report (2026-10-05)

Scope: `bionic/**`, the AGENTS.md rule 5 wording, `.agents/skills/forge-log.md`. Nothing committed. I did not run `pnpm docs:arch`, `pnpm verify`, build or dev. Everything below was run or read in this session unless marked UNVERIFIED.

## 1. ADR acceptance check (Decision by Decision)

Guards run: `pnpm exec vitest run scripts packages/database/src/migrate.test.ts packages/database/src/role-check.test.ts packages/database/src/with-tenant.test.ts` gave 122 passed and 1 failed. The one failure is `scripts/export-surface.test.ts` (interview-contracts 373 exported names vs 365 recorded; product-interview 83 vs 82). That file is modified by another worker (git status shows it modified); it is not a GOV matter. Also run: `product-routes` pair 27 passed, `product-interview` `db/security.test.ts` 11 passed, `platform-storage` `schema.test.ts` 1 passed, product-interview `db/schema.test.ts` 2 passed.

### ADR-0004 (modular monolith): NOT ACCEPTED. Decision 1 does not match the code.
- D1 Shell: MISMATCH. "It holds no product logic or product styling." `apps/web/app/styles.css` is 1,987 lines and carries product styling used only by `products/interview` (`products/interview/src/frontend/library.tsx`, `studio/**`): top-level selector prefixes counted by `grep`: `.library` 115, `.studio` 38, `.interview` 21, `.mermaid` 23, `.markdown` 17, `.presentation` 4 (e.g. `styles.css:390` `.studio`, `:1252` `.mock-interview`, `:1518` `.studio-button`). The shell does import each product's exported stylesheet (`apps/web/app/layout.tsx:8-9`), so the stylesheet has a double home. Registration, mounting and the no-hardcoded-nav parts hold: `apps/web/src/platform/registry.ts` registers by manifest; `packages/platform-runtime/src/registry.ts:118-170` builds the product links from installation data; `scripts/web-thinness.test.ts` passes (no domain logic, size caps).
- D2 Products: holds. `products/*` own manifest and routers; the invariant greps for `from 'next'` and `apps/web` imports in `products/*/src` return no output (run).
- D3 Registration and installation: holds. Build-time `ProductRegistry` (`apps/web/src/platform/registry.ts:11-17`); `scripts/product-registration.test.ts` passes (the four places a product must appear).
- D4 Routing: holds. `apps/web/app/t/[tenantSlug]/p/[productId]/[[...productPath]]/page.tsx:39-45` calls `resolvePage`; order membership, installation, permission, then loader in `packages/platform-runtime/src/registry.ts:124-156`; tests `registry.test.ts:129-282`.
- D5 Failure: holds. `DuplicateProductError`/`DuplicateRouteError` at composition (`registry.ts:58-72`); 404 for missing/disabled/permission (`registry.ts:125,136,152`; `registry.test.ts:273-282`).
- D6 Cohesion/extraction: no code claim to check.
- Repair options for the lead (not done, `apps/web` is not mine): move the product rules from `apps/web/app/styles.css` into the product stylesheets, or amend the Decision text while the ADR is still Proposed (the body is mutable until accepted).

### ADR-0005 (tenancy): ACCEPTED 2026-10-05. All six Decisions match.
- D1 one cluster, owned schemas: schemas declared per owning package (`packages/database/drizzle.config.ts:7-20` lists the schema files and `schemaFilter: platform, ai, presentation, interview, practice`); vendor `assistant` and runtime `pgboss` outside Drizzle are covered by ADR-0023 D5.
- D2/D3 tenant column, forced RLS, composite FKs: `FORCE ROW LEVEL SECURITY` appears in 10 of the 25 migrations; the INV-0001 and INV-0003 checks (`migrate.test.ts`, `security.test.ts`, `schema.test.ts`) pass; `catalog_in_tenant` triggers at `packages/database/drizzle/20261003033300_forced_rls_job_identity_and_catalog_tenancy/migration.sql:45-49`.
- D4 transaction-local context and role refusal: `packages/database/src/with-tenant.ts:21-52` (`set_config(..., true)` inside a Drizzle transaction); `connection.ts:37-45` (`verifyRole`), `:76-83` (`tenantTransaction`), `:105-112` (`enterTenant`), `:136-175` (memoised check, fixed message), boot check `apps/web/instrumentation-node.ts:21`, `apps/agent-worker/src/main.ts:366`.
- D5 one migration stream: `packages/database/drizzle/` has 25 folders in one stream; `packages/database/drizzle.config.ts`; drift tests pass.
- D6 narrow access: policies present in the migrations: `agent_worker_read/update/append`, `payload_reference_lookup`, `share_token_lookup`, `app.agent_worker` (12 hits), `app.share_token_hash`, `app.agent_payload_reference`; `app.run_worker` policy is applied by `packages/database/src/migrate.ts:12-27` and set by `products/interview/src/backend/interview-backend.ts:157`; the guard `scripts/tenant-context-boundary.test.ts` (passes) fails if a file outside `packages/database` sets tenant/actor context or a worker setting outside its owner.
- Note: PG-SEC-05 (the runtime role owns schemas and migrates) is the DATA worker's open row; ADR-0005 makes no claim about role separation, so acceptance does not depend on it.

### ADR-0006 (login vs connected accounts): ACCEPTED 2026-10-05. All four Decisions match.
- D1 two grants: `apps/web/auth.ts:76-92` stores identity only (no tokens); connected-account tokens appear only in the integrations callback.
- D2 flow: separate client env (`AUTH_*` at `auth.ts:45-58` vs `INTEGRATION_*` at `packages/platform-integrations/src/oauth.ts:37-62`); HMAC state with provider, tenant, user and expiry (`oauth.ts:26-30,84-116`, `timingSafeEqual` at `:109`); membership revalidated on callback (`apps/web/app/api/integrations/[provider]/callback/route.ts` `resolvePlatformContext(state.tenantSlug)` then tenant and user equality); AES-256-GCM vault (`packages/platform-storage/src/connected-account-vault.ts:31-33`); scopes and expiry stored (`platform-repository.ts:179-204`); no token in any response (only `access_token` hit in app code is the callback's encrypt-then-store).
- D3 503 before redirect: `authorize/route.ts` 503 at the secret and provider-config checks; callback mirrors it.
- D4 scope gating: scopes are OIDC profile only (`oauth.ts:49,59`).
- Not claimed by the ADR and not checked: PKCE (the SEC worker's row).

### ADR-0007 (AI gateway and agent isolation): NOT ACCEPTED. Decision 1 does not match the code.
- D1 "Product code never branches on a provider or model name": MISMATCH. `products/interview/src/frontend/studio/documents/assistant-model.ts:6` defines `CLAUDE_AGENT = "agent/claude-code"` and `:35` selects `targets.find((item) => item.id === CLAUDE_AGENT) ?? targets[0]`: a preference keyed on a provider-named target id, in product code. The same INV-0006 grep also matches `products/interview/src/frontend/studio/live/shared/task-card-model.ts:298-305` (display label map for `claude-code`/`codex`, display only) and `:431` (a model id in a comment). The first is a real branch; the second is presentational.
- D2 adapter kinds: holds (`packages/ai-provider-*`, `packages/agent-runtime-claude|codex`, `apps/agent-worker/src/main.ts`, `packages/agent-job-service`).
- D3 Next never launches agents: holds. The INV-0005 grep (`agent-runtime-(claude|codex)|child_process` in `apps/web`) returns no output (run).
- D4 bounded profiles: holds. `packages/agent-runtime-contracts/src/index.ts:43-62` (typed, versioned profile) and `validateAgentProfile` at `:119-` (positive version, no additional directories, positive limits, no write-without-approval).
- D5 execution style: holds (`AiExecutionFamily = "direct-model" | "agent-runtime"`, `packages/ai-contracts/src/index.ts:6`).
- D6 no content logging: holds on the code read. `apps/web/src/platform/agent-api.ts:38-47` logs route and error class only; the other `console.error` uses are the worker's fixed status lines (`apps/agent-worker/src/main.ts:164,272,276,317`). UNVERIFIED: no automated guard exists that fails on a content log.
- Repair options: change `documentTarget` to take its fallback from the host (the first target) or from a capability, then accept; or accept after the owner reviews the match (INV-0006 allows reviewed matches).

### ADR-0023 (query builder default, role check): ACCEPTED 2026-10-05. All six Decisions match.
- D1 standard and exceptions: `scripts/raw-sql-guard.test.ts` (typed allowlist with reasons, per-file caps, `:26-125,222-`) passes.
- D2 one role check: `connection.ts:37-45,60-62,76-83,92-96,105-112,136-175`; `allowRlsBypass` opt-in at `:180-195`; fail-closed `refuseUnlessRlsApplies` at `:138-146`; boot verification (see ADR-0005 D4); `role-check.test.ts` and `with-tenant.test.ts` pass.
- D3 guards are tests: `scripts/rls-role-guard.test.ts` (allowlisted opt-in with reasons) and `raw-sql-guard.test.ts` pass.
- D4 pinned settings: `scripts/tenant-context-boundary.test.ts:36-60` (the table includes `share_token_hash`, `agent_payload_reference`, `document_catalog_provisioner` with two owners) passes.
- D5 second migration mechanism: `drizzle.config.ts` `schemaFilter` excludes `assistant` and `pgboss`; the vendor policy is applied by `migrate.ts`; pg-boss is a runtime dependency (`products/interview/src/backend/interview-backend.ts:12`); the view `interview.active_session_claims` is created in `packages/database/drizzle/20261003051000_active_sessions/migration.sql:148` and read only in `products/interview/src/backend/live-session/session-claim.ts:35,86,204,228`.
- D6 wording: applied (below).

### Wording applied (ADR-0023 D6; the "wording list" is that Decision, referenced from the Outcome of `bionic/inbox/redesign/drizzle-audit.md`)
- `AGENTS.md` rule 5 now reads: tenant-scoped access goes through `withTenant()` or `tenantTransaction`, the query builder is the default for new repository code, every path runs the same database-role check; cites ADR-0005 and ADR-0023.
- `bionic/invariants/tenant-drizzle-handle-only-via-with-tenant.md` (INV-0002) Intent and Why changed to the ADR-0023 D6 statement; `related_adrs` now includes ADR-0023.
- Also `bionic/research/references/technology-references.md` Drizzle row: "Tenant access always goes through `withTenant()`" changed to match.
- Nothing else in the repo carries the old sentence (`git grep` run).

## 2. ADRs proposed (all status Proposed; numbers 0024-0032; `adr.next_number` is now 33)
| ADR | Decision | Source |
|---|---|---|
| 0024 | every regeneration is a new revision; added screenshots stage until Apply; Manual mode stages | plan D28, D29, D30, D34 |
| 0025 | on-device text recognition before any screenshot reaches the model (one port, Vision and WASM adapters) | plan D31 |
| 0026 | per-session "Screenshots to the model" setting (always / text-only-when-text / never) with a fail-toward-image gate | plan D35 |
| 0027 | a no-question capture is a note, not a task; Auto backs off | plan D36 |
| 0028 | pointer events pass through only transparent regions of the see-through window | plan T33 notes (owner confirmed 2026-10-05) |
| 0029 | data-model arch page from the project extractor behind Crux's override seam; the flag is never exported | plan D38, final report item 7 |
| 0030 | keep prompt-and-parse JSON in the direct Anthropic adapter | audit AN-ARC-02, ADR-0007 |
| 0031 | baseline security headers now, CSP deferred with its reasons | audit NX-SEC-01 |
| 0032 | toolbar capture stays a one-shot analysis; answer-pane capture stages into the tray | final report item 2 (owner locked the toolbar) |
`amends`: 0024-0027 amend ADR-0016, 0028 amends ADR-0019, 0032 amends ADR-0018. Bodies state requirements, not recipe (§11.D); all are under 75 lines. Facts I could not confirm are labelled in each Consequences section (for example ADR-0028's live checks are owed). I recorded no thresholds in ADR-0026; it names `IMAGE_GATE_THRESHOLDS` as the source of truth. ADR-0031's header list is the tracker's wording (frame-ancestors self, nosniff, referrer policy, permissions policy); the exact permissions-policy values are for WEB-HARDEN to choose, and the ADR requires that same-origin microphone use still works.
Index, `bionic/index.md` rollup, lineage, summaries and doctrine regenerated with the Crux generators; all seven dry-runs (`generate-adr-index`, `generate-index-rollup`, `generate-lineage`, `summarize-adrs`, `compile-doctrine`, `generate-journal-index`, `generate-reviews-index`) exit 0. `check-governs-coverage` reports an empty cohort.
NOT regenerated: `bionic/arch/` (its decision index reads ADR tags and statuses, so `pnpm docs:arch` after the other workers finish will show drift until it runs) and `bionic/code/`.

## 3. Invariants
- INV-0004 `product-routes-resolve-membership-first`: the 2026-10-02 `fail` was a stale record. Run: `pnpm exec vitest run packages/platform-runtime/src/registry.test.ts "apps/web/app/api/[[...route]]/route.test.ts"` gave 2 files, 27 passed (Docker up). The previously missing cases now exist (`registry.test.ts:129-282`: non-member, disabled installation, missing permission, each a 404 before product code; `route.test.ts:134,183,484`). Record now `pass`, 2026-10-05.
- INV-0002 `tenant-drizzle-handle-only-via-with-tenant`: the old failing files are fixed (they now go through `enterTenant`/`tenantTransaction`). But the check as written (a literal `git grep` for `set_config('app.tenant_id'` outside `*.test.ts` and `packages/database/src`) still prints three test-support files: `products/interview/src/backend/assistant/workspace-fixture.ts:52`, `products/interview/src/backend/live-session/processor-fixture.ts:398`, `products/presentation/integration/repository.ts:31`. So the check could not pass for a reason unrelated to the rule. I rewrote the check to run the repository guard that already encodes the fixture exemption (`pnpm exec vitest run scripts/tenant-context-boundary.test.ts scripts/rls-role-guard.test.ts`, 15 passed) and kept the history in the check file. Record now `pass`, 2026-10-05. The pin stays `observed` (the owner ratifies).
- INV-0006 `products-never-branch-on-provider-names` (ratified, recorded `pass` 2026-10-02): rerunning its grep now prints matches (see ADR-0007 D1). I did NOT mask this: the record is `fail`, and `check_invariants.py` now reports `CHK-INV-FAILING: ratified pin INV-0006 aggregate last_result=fail` as BROKEN. This is a real finding needing an owner or lead decision (fix `assistant-model.ts` or review the matches).
- INV-0001, 0003, 0005, 0007, 0008, 0009 re-run and pass (migrate, security and schema tests; the INV-0005/0007/0008 greps print nothing; `scripts/package-boundaries.test.ts` passes); dates refreshed to 2026-10-05. UNVERIFIED: INV-0003's product-interview `schema.test.ts` ran 2 tests in about 3 ms, so it may not exercise a database.
- Files changed: `bionic/invariants/reconciliation.yml`, `index.md`, the four ledger pages above plus the INV-0002 check page and refreshed "run" dates on the rest.
- Audit gate `check_invariants.py` now: 1 BROKEN (INV-0006), 2 CHK-INV-DANGEROUS warnings (INV-0002 and INV-0004 are `observed` but pass: ratify or reject them), survey_debt 2.

## 4. Skills
`.agents/skills/forge-log.md`: a `used` and an `evaluated` entry for `bionic-regeneration` (what I ran and what the skill did not cover). I wrote no entry for `technology-references` or any other skill because I did not use them. The earlier lead sessions' use of `bionic-regeneration` for `docs:arch` is not recorded by me (I did not witness it); the lead may add its own `used` line.

## 5. Technology-consistency resolution log
Appended a "Resolution log" section to `bionic/inbox/audit/technology-consistency.md` for AU-DEP-01, DK-BLD-01, NX-BLD-01, PW-TST-03, TS-DEV-01, RE-SEC-01, AN-DEP-02, AN-ARC-02, SW-ARC-01, SW-TST-01, SW-SEC-02 and item 11c G8, each with its reason, plus three "also recorded" lines (NX-SEC-01, cross-cutting 1 and 8). The reasons for PW-TST-03 and DK-BLD-01 restate the tracker's wording (sharding, `pnpm runner:build`); I did not independently verify the shard layout.

## 6. Journal and ops log
`bionic/journal/2026-10.md` has one decision entry (via `write-journal.py`, status complete); `bionic/log.md` has the nine `adr | proposed` entries, three `adr | accepted` entries and the journal entry.

## 7. For the lead
- ADR-0004 and ADR-0007 remain Proposed (mismatches above); AGENTS.md rules 3 and 7 cite them.
- `.bionic.yml` (not mine) says "or export the flag", which contradicts the decision recorded in ADR-0029 and tracker item 7 (never exported). Suggest changing that comment.
- `scripts/export-surface.test.ts` currently fails (another worker's in-flight change).
- Wave 2: run `pnpm docs:arch` and `bionic-regeneration` check again once all workers finish (arch decision index will drift).
- I changed AGENTS.md (rule 5 only), outside `bionic/`, as the brief directed.
- ADR text needed from others: none.
