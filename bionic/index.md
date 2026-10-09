# docs/omnitech-interview-answers-generator

_Last updated: 2026-10-07_

**Start here:** [[research/concepts/architecture-overview]] — how the system fits together and where package boundaries lie.

## Research (9 sources, 9 synthesis pages)

See [[research/index]].

### Sources (9)
- [[research/sources/drizzle-orm-schema-declaration]] — Drizzle schema declaration: pgTable, pgSchema, columns, indexes — `2026-10-05` — #drizzle #schema #postgres
- [[research/sources/drizzle-orm-migrations]] — Drizzle migrations fundamentals and the five approaches — `2026-10-05` — #drizzle #migrations
- [[research/sources/drizzle-kit-generate]] — drizzle-kit generate: snapshot diff, folder-per-migration layout, --custom — `2026-10-05` — #drizzle-kit #migrations #snapshot
- [[research/sources/drizzle-kit-migrate]] — drizzle-kit migrate: applied-migrations log table — `2026-10-05` — #drizzle-kit #migrations
- [[research/sources/drizzle-orm-row-level-security]] — Drizzle RLS: withRLS, pgRole, pgPolicy, entities.roles — `2026-10-05` — #drizzle #rls #policies
- [[research/sources/drizzle-orm-transactions]] — Drizzle transactions: tx, rollback, savepoints, isolation options — `2026-10-05` — #drizzle #transactions
- [[research/sources/swift-concurrency-agent-skill]] — Swift Concurrency agent skill (AvdLee, MIT), pinned by commit — `2026-10-04` — #swift #concurrency #agent-skill
- [[research/sources/vercel-composition-patterns]] — Vercel React composition patterns skill — `2026-10-04` — #react #composition #agent-skill
- [[research/sources/vercel-react-best-practices]] — Vercel React and Next.js performance rules skill — `2026-10-04` — #react #nextjs #performance #agent-skill

### Concepts (3)
- [[research/concepts/architecture-overview]] — START HERE: layers, package boundary map, request and AI flows, schema ownership — sources: 0 — `last_reviewed: 2026-10-02`
- [[research/concepts/interview-domain-model]] — interview domain tables, tenancy layers, `withTenant()`, migrations, tests — sources: 0 — `last_reviewed: 2026-10-02`
- [[research/concepts/platform-architecture]] — modular-monolith platform shape, ownership, lifecycle, failure behavior, local operations — sources: 0 — `last_reviewed: 2026-10-02`

### References (7)
- [[research/references/adding-a-product]] — steps and required surfaces for a new product vertical — sources: 0 — `last_reviewed: 2026-10-02`
- [[research/references/ai-execution-boundaries]] — direct model vs agent runtime; on-device profile — sources: 0 — `last_reviewed: 2026-10-02`
- [[research/references/interview-briefings-runbook]] — behavioural briefing pack operator runbook — sources: 0 — `last_reviewed: 2026-10-02`
- [[research/references/interview-library]] — Interview Library (Knowledge view) taxonomy, search, API, failure boundaries — sources: 0 — `last_reviewed: 2026-10-02`
- [[research/references/technology-references]] — layer-to-reference map: React, Swift, Next.js, Hono, Drizzle, Postgres, AI, review — sources: 9 — `last_reviewed: 2026-10-05`
- [[research/references/interview-studio]] — Interview Studio views, code locations, assistant model, CLI pushes — sources: 0 — `last_reviewed: 2026-10-02`
- [[research/references/ui-components]] — one config-driven component set: variants, sizes, states, design tokens, rules — sources: 0 — `last_reviewed: 2026-10-06`

## ADRs (41)

| id | title | status | date |
|---|---|---|---|
| [[adrs/ADR-0040-the-ai-engine-is-imported-at-its-one-entry-point]] | The AI engine is imported at its one entry point | Accepted | 2026-10-08 |
| [[adrs/ADR-0039-a-live-coach-reads-the-conversation-and-writes-the]] | A live coach reads the conversation and writes the coach's notes as it happens | Accepted | 2026-10-08 |
| [[adrs/ADR-0038-prepare-raw-information-into-attributable-context]] | Prepare raw information into attributable context, then resolve it deterministically, inside the AI engine | Accepted | 2026-10-08 |
| [[adrs/ADR-0037-consolidate-every-ai-interaction-behind-one-sdk-in]] | Consolidate every AI interaction behind one SDK in a standalone omnitech-ai-engine repository | Accepted | 2026-10-08 |
| [[adrs/ADR-0036-project-facts-and-scenario-context-through-one-sta]] | Project facts and scenario context through one standalone package, declared as data, with no retrieval database | Deprecated | 2026-10-08 |
| [[adrs/ADR-0035-record-every-ai-interaction-with-its-content-in-dev]] | Record every AI interaction with its content in development, as spans exported through OpenTelemetry | Deprecated | 2026-10-08 |
| [[adrs/ADR-0034-record-native-app-and-companion-events-through-one]] | Record native-app and companion events through one redacting event log | Proposed | 2026-10-07 |
| [[adrs/ADR-0033-remove-document-picture-in-picture-and-the-in-tab]] | Remove Document Picture-in-Picture and the in-tab overlay card; the native shell is the live-session surface | Proposed | 2026-10-06 |
| [[adrs/ADR-0032-keep-the-toolbar-capture-a-one-shot-analysis-and-s]] | Keep the toolbar capture a one-shot analysis and stage answer-pane captures in the tray | Proposed | 2026-10-05 |
| [[adrs/ADR-0031-send-baseline-security-headers-now-and-defer-a-con]] | Send baseline security headers now and defer a Content-Security-Policy | Proposed | 2026-10-05 |
| [[adrs/ADR-0030-keep-prompt-and-parse-json-in-the-provider-neutral]] | Keep prompt-and-parse JSON in the provider-neutral direct Anthropic adapter | Proposed | 2026-10-05 |
| [[adrs/ADR-0029-render-the-data-model-architecture-page-from-a-pro]] | Render the data-model architecture page from a project extractor behind Crux's override seam | Proposed | 2026-10-05 |
| [[adrs/ADR-0028-pass-pointer-events-through-only-the-transparent-r]] | Pass pointer events through only the transparent regions of the see-through window | Proposed | 2026-10-05 |
| [[adrs/ADR-0027-treat-a-capture-that-shows-no-interview-question-a]] | Treat a capture that shows no interview question as a note, not a task | Proposed | 2026-10-05 |
| [[adrs/ADR-0026-let-the-owner-choose-per-session-whether-screensho]] | Let the owner choose per session whether screenshots are sent to the model as images | Proposed | 2026-10-05 |
| [[adrs/ADR-0025-recognise-screenshot-text-on-the-device-before-any]] | Recognise screenshot text on the device before any screenshot reaches the model | Proposed | 2026-10-05 |
| [[adrs/ADR-0024-record-every-regeneration-as-a-new-revision-of-the]] | Record every regeneration as a new revision of the same task and stage added screenshots until Apply | Proposed | 2026-10-05 |
| [[adrs/ADR-0023-use-the-query-builder-by-default-and-check-the-dat]] | Use the query builder by default and check the database role on every tenant-scoped path | Accepted | 2026-10-05 |
| [[adrs/ADR-0022-allow-owner-enabled-hands-free-listening-and-automatic-capture]] | Allow owner-enabled hands-free listening and automatic capture | Proposed | 2026-10-04 |
| [[adrs/ADR-0021-negotiate-companion-capture-requests-and-report-their-failures]] | Negotiate companion capture requests and report their failures | Proposed | 2026-10-04 |
| [[adrs/ADR-0020-sign-in-to-studio-from-the-native-shell-through-a-one-time-handoff]] | Sign in to Studio from the native shell through a one-time handoff | Proposed | 2026-10-04 |
| [[adrs/ADR-0019-host-the-overlay-in-a-native-shell-through-one-host-adapter]] | Host the overlay in a native shell through one host adapter | Accepted | 2026-10-04 |
| [[adrs/ADR-0018-capture-on-demand-with-masks-and-owner-requested-companion-captures]] | Capture on demand with masks and owner-requested companion captures | Accepted | 2026-10-04 |
| [[adrs/ADR-0017-host-the-active-session-overlay-as-one-route-and-isolate-providers]] | Host the Active Session overlay as one route and isolate providers without emptying their home | Accepted | 2026-10-03 |
| [[adrs/ADR-0016-run-active-session-assistance-on-the-worker-executor]] | Run Active Session assistance on the worker executor with screenshots and two action slots | Accepted | 2026-10-03 |
| [[adrs/ADR-0015-validate-owned-document-batches-and-measure-grouping]] | Validate owned document batches and measure grouping | Proposed | 2026-10-03 |
| [[adrs/ADR-0014-use-worker-owned-agent-sessions-with-one-terminal]] | Use worker-owned agent sessions with one terminal outcome | Accepted | 2026-10-03 |
| [[adrs/ADR-0013-pause-rather-than-end-an-active-session-on-credent]] | Pause rather than end an Active Session on credential expiry or companion stop | Accepted | 2026-10-03 |
| [[adrs/ADR-0012-keep-active-session-data-private-to-the-actor-and]] | Keep Active Session data private to the actor and enforce locality before dispatch | Accepted | 2026-10-03 |
| [[adrs/ADR-0011-host-the-active-session-processor-in-the-agent-worker]] | Host the Active Session processor in the agent worker behind a versioned wire contract | Accepted | 2026-10-03 |
| [[adrs/ADR-0010-write-documents-in-a-few-parallel-calls-on-any-lan]] | Write documents in a few parallel calls on any language profile | Accepted | 2026-10-03 |
| [[adrs/ADR-0009-keep-interview-documents-in-the-interview-product]] | Keep candidate documents in the Interview product | Accepted | 2026-10-02 |
| [[adrs/ADR-0008-interview-answers-are-structured-guides-that-rende]] | Interview answers are structured guides that render their Markdown | Accepted | 2026-10-02 |
| [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]] | Route AI work through AiExecutionGateway profiles and run agents only in the isolated worker | Proposed | 2026-10-02 |
| [[adrs/ADR-0006-keep-login-identities-separate-from-connected-prov]] | Keep login identities separate from connected provider accounts | Accepted | 2026-10-05 |
| [[adrs/ADR-0005-isolate-tenants-in-one-postgresql-cluster-with-own]] | Isolate tenants in one PostgreSQL cluster with owned schemas and forced row-level security | Accepted | 2026-10-05 |
| [[adrs/ADR-0004-build-products-as-verticals-inside-a-modular-monol]] | Build products as verticals inside a modular-monolith platform shell | Proposed | 2026-10-02 |
| [[adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent]] | Keep package boundaries narrow with one public entrypoint per runtime surface | Accepted | 2026-10-02 |
| [[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]] | Simplicity first: the least complex design that meets current requirements | Accepted | 2026-10-02 |
| [[adrs/ADR-0001-crux-is-the-sole-ai-development-workflow]] | Crux is the sole AI development workflow | Accepted | 2026-10-02 |
| [[adrs/ADR-0000-record-architecture-decisions]] | Record architectural decisions as ADRs | Accepted | 2026-10-02 |

## Briefs (0)

_No briefs yet._

## Journal (1 month)

See [[journal/index]].

## Promptbooks (2 active, 2 archived)

See [[promptbooks/index]].

## Invariants (9)

9 pins: 7 `ratified`, 2 `observed` with failing checks (survey debt: 2 — INV-0002, INV-0004). See [[invariants/index]]; checks live in the `invariants/checks/` subdirectory.

## Observations (0)

No observation records yet. See [[observations/index]]. Records enter `observed` through `propose-observation` or the `transition-decision` observation terminal — both human-invoked, and no scan writes one — and a human ratifies via `transition-observation`; evidence is `path:line-range`, never a code excerpt.

## Code (662 pages, regenerated: 2026-10-03)

See [[code/index]]. Extracted from source by `extract-code-docs`; 32 newer sources await the next extraction.
