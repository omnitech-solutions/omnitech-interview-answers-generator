# ADRs

| id | title | status | date | supersedes | superseded_by | tags |
|----|-------|--------|------|------------|---------------|------|
| ADR-0012 | Keep Active Session data private to the actor and enforce locality before dispatch | Accepted | 2026-10-03 | — (amends ADR-0011) | — | active-session, privacy, row-security, locality, retention, interview |
| ADR-0011 | Host the Active Session processor in the agent worker behind a versioned wire contract | Accepted | 2026-10-03 | — | — | active-session, worker, contracts, privacy, interview |
| ADR-0010 | Write documents in a few parallel calls on any language profile | Accepted | 2026-10-03 | — (amends ADR-0009) | — | interview, documents, ai, agents, performance |
| ADR-0009 | Keep candidate documents in the Interview product | Accepted | 2026-10-02 | — | — | interview, documents, privacy, artifacts, ai |
| ADR-0008 | Interview answers are structured guides that render their Markdown | Accepted | 2026-10-02 | — | — | interview, answers, contracts, playground |
| ADR-0007 | Route AI work through AiExecutionGateway profiles and run agents only in the isolated worker | Proposed | 2026-10-02 | — | — | ai, execution, agents, privacy |
| ADR-0006 | Keep login identities separate from connected provider accounts | Proposed | 2026-10-02 | — | — | identity, oauth, security, integrations |
| ADR-0005 | Isolate tenants in one PostgreSQL cluster with owned schemas and forced row-level security | Proposed | 2026-10-02 | — | — | tenancy, storage, postgresql, security, drizzle |
| ADR-0004 | Build products as verticals inside a modular-monolith platform shell | Proposed | 2026-10-02 | — | — | platform, architecture, products, routing, modular-monolith |
| ADR-0003 | Keep package boundaries narrow with one public entrypoint per runtime surface | Accepted | 2026-10-02 | — | — | packages, boundaries, monorepo, database |
| ADR-0002 | Simplicity first: the least complex design that meets current requirements | Accepted | 2026-10-02 | — | — | architecture, simplicity, scope |
| ADR-0001 | Crux is the sole AI development workflow | Accepted | 2026-10-02 | — | — | process, tooling, agents, crux |
| ADR-0000 | Record architectural decisions as ADRs | Accepted | 2026-10-02 | — | — | meta, process |

## Archived (0)

| id | title | status |
|----|-------|--------|
