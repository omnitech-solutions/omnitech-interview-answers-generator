# ADRs

| id | title | status | date | supersedes | superseded_by | tags |
|----|-------|--------|------|------------|---------------|------|
| ADR-0041 | The first context pack slice derives identities from content and adds three rules | Accepted | 2026-10-09 | — (amends ADR-0038, ADR-0039) | — | context, projection, coach, experience-matrix, grounding |
| ADR-0040 | The AI engine is imported at its one entry point | Accepted | 2026-10-08 | — (amends ADR-0037) | — | ai, sdk, engine, packages, boundaries |
| ADR-0039 | A live coach reads the conversation and writes the coach's notes as it happens | Accepted | 2026-10-08 | — | — | coach, live-session, agents, transcript, grounding |
| ADR-0038 | Prepare raw information into attributable context, then resolve it deterministically, inside the AI engine | Accepted | 2026-10-08 | — | — | context, projection, engine, documents, experience-matrix |
| ADR-0037 | Consolidate every AI interaction behind one SDK in a standalone omnitech-ai-engine repository | Accepted | 2026-10-08 | — (amends ADR-0003, ADR-0007, ADR-0012, ADR-0034) | — | ai, sdk, engine, agents, observability, packages |
| ADR-0034 | Record native-app and companion events through one redacting event log | Proposed | 2026-10-07 | — (amends ADR-0007) | — | observability, native, logging, active-session |
| ADR-0033 | Remove Document Picture-in-Picture and the in-tab overlay card; the native shell is the live-session surface | Proposed | 2026-10-06 | — (amends ADR-0017) | — | active-session, overlay, pip, native, live-ui |
| ADR-0032 | Keep the toolbar capture a one-shot analysis and stage answer-pane captures in the tray | Proposed | 2026-10-05 | — (amends ADR-0018) | — | active-session, capture, toolbar, live-ui |
| ADR-0031 | Send baseline security headers now and defer a Content-Security-Policy | Proposed | 2026-10-05 | — | — | security, nextjs, headers, csp |
| ADR-0030 | Keep prompt-and-parse JSON in the provider-neutral direct Anthropic adapter | Proposed | 2026-10-05 | — | — | ai, anthropic, adapters, structured-output |
| ADR-0029 | Render the data-model architecture page from a project extractor behind Crux's override seam | Proposed | 2026-10-05 | — | — | architecture, crux, documentation, drizzle, tooling |
| ADR-0028 | Pass pointer events through only the transparent regions of the see-through window | Proposed | 2026-10-05 | — (amends ADR-0019) | — | active-session, overlay, native, macos, presentation |
| ADR-0027 | Treat a capture that shows no interview question as a note, not a task | Proposed | 2026-10-05 | — (amends ADR-0016) | — | active-session, capture, tasks, live-ui |
| ADR-0026 | Let the owner choose per session whether screenshots are sent to the model as images | Proposed | 2026-10-05 | — (amends ADR-0016) | — | active-session, screenshots, privacy, ocr, settings |
| ADR-0025 | Recognise screenshot text on the device before any screenshot reaches the model | Proposed | 2026-10-05 | — (amends ADR-0016) | — | active-session, ocr, screenshots, privacy |
| ADR-0024 | Record every regeneration as a new revision of the same task and stage added screenshots until Apply | Proposed | 2026-10-05 | — (amends ADR-0016) | — | active-session, revisions, screenshots, privacy, live-ui |
| ADR-0023 | Use the query builder by default and check the database role on every tenant-scoped path | Accepted | 2026-10-05 | — (amends ADR-0005) | — | tenancy, drizzle, postgresql, security, data-access |
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
| ADR-0006 | Keep login identities separate from connected provider accounts | Accepted | 2026-10-05 | — | — | identity, oauth, security, integrations |
| ADR-0005 | Isolate tenants in one PostgreSQL cluster with owned schemas and forced row-level security | Accepted | 2026-10-05 | — | — | tenancy, storage, postgresql, security, drizzle |
| ADR-0004 | Build products as verticals inside a modular-monolith platform shell | Proposed | 2026-10-02 | — | — | platform, architecture, products, routing, modular-monolith |
| ADR-0003 | Keep package boundaries narrow with one public entrypoint per runtime surface | Accepted | 2026-10-02 | — | — | packages, boundaries, monorepo, database |
| ADR-0002 | Simplicity first: the least complex design that meets current requirements | Accepted | 2026-10-02 | — | — | architecture, simplicity, scope |
| ADR-0001 | Crux is the sole AI development workflow | Accepted | 2026-10-02 | — | — | process, tooling, agents, crux |
| ADR-0000 | Record architectural decisions as ADRs | Accepted | 2026-10-02 | — | — | meta, process |

## Archived (2)

| id | title | status |
|----|-------|--------|
| ADR-0036 | Project facts and scenario context through one standalone package, declared as data, with no retrieval database | Deprecated |
| ADR-0035 | Record every AI interaction with its content in development, as spans exported through OpenTelemetry | Deprecated |
