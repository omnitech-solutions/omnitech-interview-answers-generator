# Operations log

_Append-only. Newest first._

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

Proposed. File `bionic/adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles.md`. Tags: ai, execution, agents, privacy, langchain, langgraph.

## [2026-10-02] adr | ADR-0006: Keep login identities separate from connected provider accounts

Proposed. File `bionic/adrs/ADR-0006-keep-login-identities-separate-from-connected-prov.md`. Tags: identity, oauth, security, integrations.

## [2026-10-02] adr | ADR-0005: Isolate tenants in one PostgreSQL cluster with owned schemas and forced row-level security

Proposed. File `bionic/adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own.md`. Tags: tenancy, storage, postgresql, security, drizzle.

## [2026-10-02] adr | ADR-0004: Build products as verticals inside a modular-monolith platform shell

Proposed. File `bionic/adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol.md`. Tags: platform, architecture, products, routing, modular-monolith.

## [2026-10-02] adr | ADR-0003: Keep package boundaries narrow with one public entrypoint per runtime surface

Proposed. File `bionic/adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent.md`. Tags: packages, boundaries, monorepo, database.

## [2026-10-02] adr | ADR-0002: Simplicity first: the least complex design that meets current requirements

Proposed. File `bionic/adrs/ADR-0002-choose-the-smallest-architecture-option-that-satis.md`. Tags: architecture, simplicity, scope.

## [2026-10-02] adr | ADR-0001: Crux is the sole AI development workflow

Proposed. File `bionic/adrs/ADR-0001-crux-is-the-sole-ai-development-workflow.md`. Tags: process, tooling, agents, crux.

## [2026-10-02] init | crux bootstrap

Created `bionic/` tree at schema_version 5 (seven concerns incl. invariants, plus the arch spine (deferred to first derive/audit) and the observations concern). Detected languages: typescript, markdown. Meta-ADR seeded.
