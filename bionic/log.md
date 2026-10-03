# Operations log

_Append-only. Newest first._

## [2026-10-02] audit | 0 broken in migrated files / 0 drift fixed / 4 pre-existing findings reported

Inline walk (51 .md files) after filing docs into bionic/. ADR, research, invariants (8 observed, survey debt 8), observations, record numbers, log enum and all enrolled drift gates clean.
Not fixed: CHK-ARCH-1 arch spine never derived. `derive-arch` output is byte-stable JSON that the repo's biome pre-commit format check rewrites, so it cannot be committed until `biome.json` excludes `bionic/`.
Pre-existing, not fixed: CHK-CODE-1/4 code docs never extracted (`extract-code-docs` would add 297 pages; user's call), so `[[code/index]]` in `index.md` dangles; CHK-INSTR-1 committed `CLAUDE.md` (removal owned by the ADR-0001 tooling change).

## [2026-10-02] journal | decision: Filed repository documentation into bionic and recorded crux as the sole workflow

Entry in `bionic/journal/2026-10.md` at 2026-10-02T20:07-06:00. Refs: [[adrs/ADR-0001-crux-is-the-sole-ai-development-workflow]] [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]] [[invariants/index]] [[research/index]]

## [2026-10-02] adr | regenerated lineage

9 nodes, 0 supersedes edges, 0 amends edges. Also regenerated the empty summaries (`adrs/summaries/`), doctrine (`adrs/doctrine/`) and reviews-index (`adrs/reviews/index.md`) projections so their drift gates are clean.

## [2026-10-02] ingest | filed project docs as research synthesis pages

Seven synthesis pages from the former `docs/` and `devdocs/` (commit 4c50c5e), no source captures (`sources: []`): `research/concepts/{platform-architecture,interview-domain-model}.md`, `research/references/{ai-execution-boundaries,adding-a-product,interview-studio,interview-briefings-runbook,interview-library}.md`.
Decision content moved to ADR-0002..ADR-0008 and linked. Stale claims (migrations/tenant transactions in platform-storage, rulesync gate) corrected against code at 4c50c5e.

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

## [2026-10-02] adr | ADR-0002: Choose the smallest architecture option that satisfies current requirements

Proposed. File `bionic/adrs/ADR-0002-choose-the-smallest-architecture-option-that-satis.md`. Tags: architecture, simplicity, scope.

## [2026-10-02] adr | ADR-0001: Crux is the sole AI development workflow

Proposed. File `bionic/adrs/ADR-0001-crux-is-the-sole-ai-development-workflow.md`. Tags: process, tooling, agents, crux.

## [2026-10-02] init | crux bootstrap

Created `bionic/` tree at schema_version 5 (seven concerns incl. invariants, plus the arch spine (deferred to first derive/audit) and the observations concern). Detected languages: typescript, markdown. Meta-ADR seeded.
