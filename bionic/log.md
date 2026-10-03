# Operations log

_Append-only. Newest first._

## [2026-10-03] promptbook | started PB-0002-active-session-capability-for-interview-studio/RUN-001

book PB-0002, run RUN-001, total_prompts: 29, current_prompt: 1. Base commit 4479e9d on feat/active-session (worktree omnitech-active-session).

## [2026-10-03] promptbook | authored PB-0002-active-session-capability-for-interview-studio (cycle)

id PB-0002, "Cycle: Active Session capability for Interview Studio", total_prompts: 29, modules (2×ADR, 4×dev, 1×review). cycle: assembled from modular templates. Dev #3 (UI) split from Dev #4 (companion + hardening) before the run. Run stacks on the committed feat/interview-documents base (operator instruction 2026-10-03).

## [2026-10-02] arch | regenerated bionic/arch/ (spine 39d9326b7f5e)

Regenerated after ADR-0009 acceptance and Interview Documents source changes. The decision index and module graph changed; the data-model extractor remains stubbed for this Drizzle repository.

## [2026-10-02] extract | regenerated bionic/code/ (361 pages: 361 added, 0 changed, 0 removed)

Ran the configured TypeScript fallback extractor after Interview Documents implementation. No pages were removed.

## [2026-10-02] adr | compiled bionic/adrs/doctrine/ (2 files)

Updated `_meta.json` and `index.md` after ADR-0009 acceptance; confirming dry-run reported no drift.

## [2026-10-02] journal | decision: Interview Documents ADR accepted after council review

Entry in `bionic/journal/2026-10.md` at 2026-10-02T22:25-06:00. Refs: [[adrs/ADR-0009-keep-interview-documents-in-the-interview-product]] rule:member-private-documents rule:immutable-document-revisions

## [2026-10-02] adr | ADR-0009: accept (accepted)

Keep candidate documents in the Interview product. Accepted after three council rounds.

## [2026-10-02] adr | ADR-0009: Keep candidate documents in the Interview product

Proposed. File `bionic/adrs/ADR-0009-keep-interview-documents-in-the-interview-product.md`. Tags: interview, documents, privacy, artifacts, ai.

## [2026-10-02] promptbook | started PB-0001-interview-documents-in-interview-studio/RUN-001

Book id: PB-0001. Run id: RUN-001. total_prompts: 17. current_prompt: 1.

## [2026-10-02] promptbook | authored PB-0001-interview-documents-in-interview-studio (cycle)

ID: PB-0001. Title: Cycle: Interview Documents in Interview Studio. total_prompts: 17. Modules: 1×ADR, 2×dev, 1×review. Cycle: assembled from modular templates.

## [2026-10-02] journal | review: Independent ADR acceptance and invariant ratification

Entry in `bionic/journal/2026-10.md` at 2026-10-02T21:30-06:00. Refs: [[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]] [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]] [[adrs/ADR-0006-keep-login-identities-separate-from-connected-prov]] [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]] [[invariants/index]]

## [2026-10-02] arch | regenerated bionic/arch/ (decision index lists 5 accepted ADRs)

Re-derived after ADR-0001, ADR-0002, ADR-0003 and ADR-0008 were accepted. `decision-index.md` lists ADR-0000, ADR-0001, ADR-0002, ADR-0003, ADR-0008.

## [2026-10-02] adr | regenerated lineage and ADR views

9 nodes, 0 supersedes edges, 0 amends edges. `adrs/index.md`, `summaries/`, `doctrine/` and the `## ADRs` rollup in `index.md` regenerated after four acceptances and seven ratifications.

## [2026-10-02] invariant | INV-0009: observed → ratified

INV-0009 (contract): ratified on the owner's instruction (ratify every pin whose check passes); its check passed 2026-10-02. Provenance stays recovered.

## [2026-10-02] invariant | INV-0008: observed → ratified

INV-0008 (contract): ratified on the owner's instruction (ratify every pin whose check passes); its check passed 2026-10-02. Provenance stays recovered.

## [2026-10-02] invariant | INV-0007: observed → ratified

INV-0007 (contract): ratified on the owner's instruction (ratify every pin whose check passes); its check passed 2026-10-02. Provenance stays recovered.

## [2026-10-02] invariant | INV-0006: observed → ratified

INV-0006 (contract): ratified on the owner's instruction (ratify every pin whose check passes); its check passed 2026-10-02. Provenance stays recovered.

## [2026-10-02] invariant | INV-0005: observed → ratified

INV-0005 (contract): ratified on the owner's instruction (ratify every pin whose check passes); its check passed 2026-10-02. Provenance stays recovered.

## [2026-10-02] invariant | INV-0003: observed → ratified

INV-0003 (shape): ratified on the owner's instruction (ratify every pin whose check passes); its check passed 2026-10-02. Provenance stays recovered.

## [2026-10-02] invariant | INV-0001: observed → ratified

INV-0001 (data): ratified on the owner's instruction (ratify every pin whose check passes); its check passed 2026-10-02. Provenance stays recovered.

## [2026-10-02] lint | invariant checks run: 7 pass, 2 fail

`invariants/reconciliation.yml` and pin `verification.last_result` recorded for INV-0001..INV-0009. Fail: INV-0002 (tenant or actor context set outside `packages/database/src` in `platform-storage/src/bootstrap.ts`, `presentation/src/repositories/index.ts`, `interview/src/backend/assistant/workspace.ts`); INV-0004 (`platform-api/src/router.test.ts` has no non-member, disabled-installation or missing-permission 404 case).
Check commands fixed: `checks/tenant-owned-tables-force-rls.md`, `checks/schema-files-and-migrations-agree.md`, `checks/product-routes-resolve-membership-first.md` run vitest from the repository root; `pnpm --filter <pkg> exec vitest run src/...` found no test files under the root project config.

## [2026-10-02] adr | ADR-0008: accept (accepted)

Interview answers are structured guides that render their Markdown. Accepted by an independent architect after review against the code. Body frozen.

## [2026-10-02] adr | ADR-0003: accept (accepted)

Keep package boundaries narrow with one public entrypoint per runtime surface. Accepted by an independent architect after review against the code. Body frozen.

## [2026-10-02] adr | ADR-0002: accept (accepted)

Simplicity first: the least complex design that meets current requirements. Accepted by an independent architect after review against the code. Body frozen.

## [2026-10-02] adr | ADR-0001: accept (accepted)

Crux is the sole AI development workflow. Accepted by an independent architect after review against the code. Body frozen.

## [2026-10-02] journal | implementation: Forced RLS on every schema and package boundaries enforced in verify

Entry in `bionic/journal/2026-10.md` at 2026-10-02T21:05-06:00. Refs: [[research/concepts/architecture-overview]] [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]] [[adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent]] [[invariants/package-boundaries-hold]]

## [2026-10-02] arch | regenerated bionic/arch/ (8 files; spine 61bba9bd2092)

Re-derived after the AI workflow packages were removed. ADR-0003, ADR-0007 and `research/references/ai-execution-boundaries.md` no longer name `ai-workflow-*`.

## [2026-10-02] arch | regenerated bionic/arch/ (8 files; spine 178292838431)

First derive. `data-model` stubbed: no supported schema extractor reads the Drizzle schemas. Trigger: CHK-ARCH-1.

## [2026-10-02] adr | regenerated lineage

9 nodes, 0 supersedes edges, 0 amends edges. Summaries, doctrine and reviews-index projections regenerated after the ADR-0001..ADR-0008 revision.

## [2026-10-02] adr | ADR-0001..ADR-0008: bodies revised while Proposed

Each body states the current decision with Context, Decision, Consequences and References; References cite `bionic/research/` pages and the enforcing code paths. ADR-0002 retitled "Simplicity first: the least complex design that meets current requirements". ADR-0005 Decision 4 names both tenant-context paths (`withTenant()`, `tenantTransaction`). Invariant confidence lines and research pages cite current pages only.

## [2026-10-02] audit | 0 broken in migrated files / 0 drift fixed / 4 pre-existing findings reported

Inline walk (51 .md files) after documenting the platform in bionic/. ADR, research, invariants (8 observed, survey debt 8), observations, record numbers, log enum and all enrolled drift gates clean.
Not fixed: CHK-ARCH-1 arch spine not yet derived.
Not fixed: CHK-CODE-1/4 code docs never extracted (`extract-code-docs` would add 297 pages; owner's call), so `[[code/index]]` in `index.md` dangles; CHK-INSTR-1 instruction-file layout, owned by ADR-0001.

## [2026-10-02] journal | decision: Documented the platform in bionic and recorded crux as the sole workflow

Entry in `bionic/journal/2026-10.md` at 2026-10-02T20:07-06:00. Refs: [[adrs/ADR-0001-crux-is-the-sole-ai-development-workflow]] [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]] [[invariants/index]] [[research/index]]

## [2026-10-02] adr | regenerated lineage

9 nodes, 0 supersedes edges, 0 amends edges. Also regenerated the empty summaries (`adrs/summaries/`), doctrine (`adrs/doctrine/`) and reviews-index (`adrs/reviews/index.md`) projections so their drift gates are clean.

## [2026-10-02] ingest | documented the platform as research synthesis pages

Seven synthesis pages, no source captures (`sources: []`): `research/concepts/{platform-architecture,interview-domain-model}.md`, `research/references/{ai-execution-boundaries,adding-a-product,interview-studio,interview-briefings-runbook,interview-library}.md`.
Decisions recorded in ADR-0002..ADR-0008 and linked. Each page checked against the code: tenant transactions and the migration stream live in `packages/database`.

## [2026-10-02] adr | ADR-0008: Interview answers are structured guides that render their Markdown

Proposed. File `bionic/adrs/ADR-0008-interview-answers-are-structured-guides-that-rende.md`. Tags: interview, answers, contracts, playground.

## [2026-10-02] adr | ADR-0007: Route AI work through AiExecutionGateway profiles and run agents only in the isolated worker

Proposed. File `bionic/adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles.md`. Tags: ai, execution, agents, privacy.

## [2026-10-02] adr | ADR-0006: Keep login identities separate from connected provider accounts

Proposed. File `bionic/adrs/ADR-0006-keep-login-identities-separate-from-connected-prov.md`. Tags: identity, oauth, security, integrations.

## [2026-10-02] adr | ADR-0005: Isolate tenants in one PostgreSQL cluster with owned schemas and forced row-level security

Proposed. File `bionic/adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own.md`. Tags: tenancy, storage, postgresql, security, drizzle.

## [2026-10-02] adr | ADR-0004: Build products as verticals inside a modular-monolith platform shell

Proposed. File `bionic/adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol.md`. Tags: platform, architecture, products, routing, modular-monolith.

## [2026-10-02] adr | ADR-0003: Keep package boundaries narrow with one public entrypoint per runtime surface

Proposed. File `bionic/adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent.md`. Tags: packages, boundaries, monorepo, database.

## [2026-10-02] adr | ADR-0002: Simplicity first: the least complex design that meets current requirements

Proposed. File `bionic/adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee.md`. Tags: architecture, simplicity, scope.

## [2026-10-02] adr | ADR-0001: Crux is the sole AI development workflow

Proposed. File `bionic/adrs/ADR-0001-crux-is-the-sole-ai-development-workflow.md`. Tags: process, tooling, agents, crux.

## [2026-10-02] init | crux bootstrap

Created `bionic/` tree at schema_version 5 (seven concerns incl. invariants, plus the arch spine (deferred to first derive/audit) and the observations concern). Detected languages: typescript, markdown. Meta-ADR seeded.
