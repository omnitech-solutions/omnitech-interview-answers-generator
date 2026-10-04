# ADRs

| id | title | status | date | supersedes | superseded_by | tags |
|----|-------|--------|------|------------|---------------|------|
| ADR-0022 | Allow owner-enabled hands-free listening and automatic capture | Proposed | 2026-10-04 | — (amends ADR-0018) | — | active-session, overlay, capture, privacy, hands-free |
| ADR-0021 | Negotiate companion capture requests and report their failures | Proposed | 2026-10-04 | — (amends ADR-0018) | — | active-session, companion, wire, negotiation, capture |
| ADR-0020 | Sign in to Studio from the native shell through a one-time handoff | Proposed | 2026-10-04 | — (amends ADR-0019) | — | active-session, native, auth, oauth, privacy |
| ADR-0019 | Host the overlay in a native shell through one host adapter | Accepted | 2026-10-04 | — (amends ADR-0017, ADR-0018) | — | active-session, overlay, native, macos, adapter, privacy |
| ADR-0018 | Capture on demand with masks and owner-requested companion captures | Accepted | 2026-10-04 | — (amends ADR-0016) | — | active-session, capture, privacy, companion, overlay |
| ADR-0017 | Host the Active Session overlay as one route and isolate providers without emptying their home | Accepted | 2026-10-03 | — (amends ADR-0016) | — | active-session, overlay, pip, agents, isolation, structured-output |
| ADR-0016 | Run Active Session assistance on the worker executor with screenshots and two action slots | Accepted | 2026-10-03 | — (amends ADR-0011) | — | active-session, agents, screenshots, concurrency, live-ui |
| ADR-0015 | Validate owned document batches and measure grouping | Proposed | 2026-10-03 | — (amends ADR-0010) | — | interview, documents, generation, grounding, performance |
| ADR-0014 | Use worker-owned agent sessions with one terminal outcome | Accepted | 2026-10-03 | — | — | ai, agents, runtime, reliability, streaming |
| ADR-0013 | Pause rather than end an Active Session on credential expiry or companion stop | Accepted | 2026-10-03 | — (amends ADR-0011, ADR-0012) | — | active-session, privacy, credential, interview |
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
