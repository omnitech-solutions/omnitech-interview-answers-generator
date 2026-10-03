# docs/omnitech-interview-answers-generator

_Last updated: 2026-10-03_

**Start here:** [[research/concepts/architecture-overview]] — how the system fits together and where package boundaries lie.

## Research (0 sources, 8 synthesis pages)

See [[research/index]].

### Concepts (3)
- [[research/concepts/architecture-overview]] — START HERE: layers, package boundary map, request and AI flows, schema ownership — sources: 0 — `last_reviewed: 2026-10-02`
- [[research/concepts/interview-domain-model]] — interview domain tables, tenancy layers, `withTenant()`, migrations, tests — sources: 0 — `last_reviewed: 2026-10-02`
- [[research/concepts/platform-architecture]] — modular-monolith platform shape, ownership, lifecycle, failure behavior, local operations — sources: 0 — `last_reviewed: 2026-10-02`

### References (5)
- [[research/references/adding-a-product]] — steps and required surfaces for a new product vertical — sources: 0 — `last_reviewed: 2026-10-02`
- [[research/references/ai-execution-boundaries]] — direct model vs agent runtime; on-device profile — sources: 0 — `last_reviewed: 2026-10-02`
- [[research/references/interview-briefings-runbook]] — behavioural briefing pack operator runbook — sources: 0 — `last_reviewed: 2026-10-02`
- [[research/references/interview-library]] — Interview Library (Knowledge view) taxonomy, search, API, failure boundaries — sources: 0 — `last_reviewed: 2026-10-02`
- [[research/references/interview-studio]] — Interview Studio views, code locations, assistant model, CLI pushes — sources: 0 — `last_reviewed: 2026-10-02`

## ADRs (10)

| id | title | status | date |
|---|---|---|---|
| [[adrs/ADR-0009-keep-interview-documents-in-the-interview-product]] | Keep candidate documents in the Interview product | Accepted | 2026-10-02 |
| [[adrs/ADR-0008-interview-answers-are-structured-guides-that-rende]] | Interview answers are structured guides that render their Markdown | Accepted | 2026-10-02 |
| [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]] | Route AI work through AiExecutionGateway profiles and run agents only in the isolated worker | Proposed | 2026-10-02 |
| [[adrs/ADR-0006-keep-login-identities-separate-from-connected-prov]] | Keep login identities separate from connected provider accounts | Proposed | 2026-10-02 |
| [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]] | Isolate tenants in one PostgreSQL cluster with owned schemas and forced row-level security | Proposed | 2026-10-02 |
| [[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]] | Build products as verticals inside a modular-monolith platform shell | Proposed | 2026-10-02 |
| [[adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent]] | Keep package boundaries narrow with one public entrypoint per runtime surface | Accepted | 2026-10-02 |
| [[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]] | Simplicity first: the least complex design that meets current requirements | Accepted | 2026-10-02 |
| [[adrs/ADR-0001-crux-is-the-sole-ai-development-workflow]] | Crux is the sole AI development workflow | Accepted | 2026-10-02 |
| [[adrs/ADR-0000-record-architecture-decisions]] | Record architectural decisions as ADRs | Accepted | 2026-10-02 |

## Briefs (0)

_No briefs yet._

## Journal (1 month)

See [[journal/index]].

## Promptbooks (2 active, 0 archived)

See [[promptbooks/index]].

## Invariants (9)

9 pins: 7 `ratified`, 2 `observed` with failing checks (survey debt: 2 — INV-0002, INV-0004). See [[invariants/index]]; checks live in the `invariants/checks/` subdirectory.

## Observations (0)

No observation records yet. See [[observations/index]]. Records enter `observed` through `propose-observation` or the `transition-decision` observation terminal — both human-invoked, and no scan writes one — and a human ratifies via `transition-observation`; evidence is `path:line-range`, never a code excerpt.

## Code (regenerated: never)

_No pages yet. Run `extract-code-docs` to populate. See [[code/index]] once present._
