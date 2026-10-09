---
id: ADR-0037
title: "Consolidate every AI interaction behind one SDK in a standalone omnitech-ai-engine repository"
status: Proposed
date: 2026-10-08
proposed_date: 2026-10-08
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0003, ADR-0007, ADR-0012, ADR-0034]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [ai, sdk, engine, agents, observability, packages]
related_briefs: []
related_research: []
governs: []
---

# ADR-0037 — Consolidate every AI interaction behind one SDK in a standalone omnitech-ai-engine repository

## Context

> **Body budget:** 157 lines — the published surface of the SDK is the decision, so it carries worked scenarios.

Interview Studio has good parts and no whole. Providers, runtimes, contracts, a gateway and a job
service exist as eleven packages that a consumer must assemble. A comparison on 2026-10-08 counted
six ways to reach a model from Studio (execute, stream, a structured stream, agent jobs created
directly, the assistant's HTTP client, an on-device relay that bypasses the gateway), four event
vocabularies, two usage shapes and four profile types. The embeddable assistant, a separate
repository, has one way and its own providers, and Studio's AI contracts already import the
assistant's model types through vendored tarballs: the dependency runs backwards. The same
comparison found defects that the scatter hides: an adapter declaring tools and vision it does not
implement, an idempotency key nothing reads, three configuration tables no code references, a
repair loop written four times, and no durable record of what a model was given.

The owner wants one cohesive, configuration-driven SDK that Studio and the assistant both consume,
that other platforms can install, and that one person can maintain. A neighbouring ecosystem built
as separate repositories per component needed three further repositories and about 30,000 lines
only to stay coherent, and its consumers still drifted across four contract versions in a month.
This record replaces ADR-0035, which decided the interaction record for Studio alone.

## Decision

- A new repository, `omnitech-ai-engine`, holds one SDK. It is embedded, not a service: it runs
  inside each host's own server and worker processes. A standalone repository and a separately
  deployed service are separate decisions, and only the first is taken.
- Every AI interaction goes through it: a model call, an image, an agent runtime. There is one
  layer to learn. Each operation is named for the promise it makes, and no operation reports
  completion for work it has only queued:

  | Operation | Promise |
  |---|---|
  | `generate` | Validated output, or a typed failure |
  | `stream` | The execution as it happens, ending in one terminal event |
  | `images` | A generated image, or a typed failure |
  | `jobs.submit` | A receipt for durable work |
  | `jobs.events` | That job's real lifecycle and output, in order |
  | `jobs.cancel` | A request; the terminal event states the outcome |
  | `jobs.resume` | Continues supported state or starts a new attempt, and says which |

- Agent runtimes (Claude Code, Codex) are first-class and move with their proven behaviour
  intact: leases, fenced writes, ordered events, private jobs, and the rule that they run only in a
  worker (ADR-0007). A model provider and an agent runtime stay distinct kinds of adapter behind
  the same engine.
- The engine is built from the strongest existing implementation of each concern, starting with
  the assistant's model contract and providers. The dependency is reversed: the assistant and
  Studio depend on the engine, and the engine depends on neither.
- It is constructed once from trusted configuration: profiles, providers, runtimes and prices are
  validated data. Nothing inside reads the environment.
- Importing the contracts, the context resolver or a browser client starts nothing: no
  credentials, file access, database, timers, workers or processes.
- Persistence is an optional adapter on the host's PostgreSQL. It owns its own schema, numbered
  migrations and a ledger; migrations run explicitly at deployment and start-up only verifies. It
  installs fresh, and it adopts Studio's existing AI tables without losing data. It takes part in
  the host's transaction rather than opening its own, so a product guard and a job can commit
  together. Tenants are isolated by the host's own row-level setting. Several platforms means
  several installations until a shared deployment is actually needed.
- Every interaction is recorded: what came in, the prompt sent, the context selected and cut, the
  raw output, model, usage, timing and outcome, shaped as spans and emitted through OpenTelemetry
  with the GenAI naming. Content is captured in development and refused in production; it stays in
  the host's database and is not placed on exported spans. Retention is the host's policy.
- A call repeated with the same idempotency key and the same input replays its result; the same
  key with different input is a conflict. Usage is summed across attempts and repair turns. An
  effect whose completion cannot be established is reported as such, never as success.
- Ownership is fixed:

  | Engine | Assistant | Host product |
  |---|---|---|
  | Providers, the inference contract, schema validation, agent runtimes, jobs, the interaction record, context mechanics (ADR-0038) | The React experience, conversations and branches, reviewed edits and their receipts | Sign-in, membership, permissions, business data, domain schemas, prompts, product tools, credentials, retention |

- Running user code is not an AI concern. It becomes `omnitech-code-runner`, a separate package
  with product-neutral contracts, in the same repository. Code generation starts as a named
  operation of the engine and earns a package only if reuse demands one.
- No AI framework is the base. The engine is a thin layer over the providers' own SDKs.
- The contract ships with the cases that prove an implementation conforms, under one version, with
  a written rule for what counts as a breaking change. Products consume a versioned release from a
  private registry; vendored tarballs are retired.

### Worked scenarios

**1. A streamed, structured answer.** The live assistant hears a question.

| Step | What happens | Recorded |
|---|---|---|
| Host | Builds the engine once from its configuration | — |
| Product | Calls `stream` with a profile name, messages, an output schema and what the call is for | Input |
| Engine | Checks the caller, resolves the profile to a provider, sends the request | Prompt, model, parameters |
| Engine | Yields parts as they arrive; validates the final value; one repair turn if it fails | Raw output, the repair, usage summed |
| Product | Shows the answer; a cancel ends the stream with a `cancelled` terminal event | Outcome, timing |

**2. An agent job.** A presentation asks Claude Code to edit a deck.

| Step | What happens |
|---|---|
| Product, inside its own transaction | Checks its guard and calls `jobs.submit`; both commit or neither does |
| Worker tier | Claims the job under a lease and runs the runtime adapter |
| Product | Reads `jobs.events` in order: started, text, tool use, completed |
| Worker dies mid-run | The lease expires, the attempt is fenced off, a new attempt starts; a late write from the old one is refused |
| Person cancels | `jobs.cancel` is recorded; the terminal event says cancelled, completed, or unknown |

**3. Installing the tables.**

| Host | What it runs | Result |
|---|---|---|
| A new platform | The engine's migrations at deployment | The engine's schema, with only the tables for the capabilities enabled |
| Interview Studio | The same command | Existing AI tables adopted in place and brought to the current version; no data lost; Studio's own migration history untouched |
| Either, at start-up | Nothing is changed | The engine refuses to run if the schema is behind |

## Alternatives Considered

### Option A — Move the eleven packages to a new repository as they are
- **Pros:** quick; no behaviour changes.
- **Cons:** the six ways to call a model, the duplicate adapters and the backwards dependency all
  move with them.
- **Why not:** the problem is coherence, not location.

### Option B — Adopt a framework (Vercel AI SDK, Mastra, LangChain) as the engine
- **Pros:** much is provided; familiar to others.
- **Cons:** its contracts replace proven ones; a major version roughly twice a year; the assistant
  forbids these dependencies by a guard; recovery in such frameworks can reissue model and tool calls.
- **Why not:** one maintainer cannot absorb that churn, and the existing adapters already work.

### Option C — A separately deployed AI service
- **Pros:** one running copy for every platform.
- **Cons:** a network boundary, service authentication, deployment, and transactions that can no
  longer include the product's own writes.
- **Why not:** nothing yet needs independent operation.

### Option D — A repository per component
- **Pros:** each part versions alone.
- **Cons:** the coordination cost measured in the neighbouring ecosystem.
- **Why not:** that cost is the thing being avoided.

## Consequences

**Positive:**
- One way to call a model, one event vocabulary, one usage shape, one profile type.
- The assistant becomes mostly a React application with a small service.
- The defects the scatter hid are removed by having one implementation of each concern.
- What a model was given is on record for every path.

**Negative:**
- A second repository and a release step between a change and its use in a product.
- A large refactor of Studio's AI packages, staged behind re-exports so call sites move one at a time.
- Adopting existing tables is harder than creating new ones.
- The GenAI naming is still changing and may need renaming.

**Follow-on work, in order:**
1. Write the public contract as usage examples with expected results, before any code moves.
2. Extract the assistant's model contract and providers as the core; the assistant re-exports them.
3. Bring in Studio's gateway, failure types and images; its packages become re-exports.
4. One structured-output path; remove the four repair loops.
5. Profiles from configuration instead of the environment.
6. Agent contracts, runtimes and jobs; give the assistant's turn a single lifecycle owner.
7. The interaction record and cost.
8. Extract `omnitech-code-runner`.

## References

- [[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]]
- [[adrs/ADR-0003-keep-package-boundaries-narrow-with-one-public-ent]]
- [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]]
- [[adrs/ADR-0035-record-every-ai-interaction-with-its-content-in-dev]] (replaced by this record)
- [[adrs/ADR-0038-prepare-raw-information-into-attributable-context]]
- Research of 2026-10-08: a comparison of four AI stacks by concern with a call-site census; a
  system audit of a neighbouring multi-repository ecosystem; a survey of AI SDK organisation,
  libraries that install their own tables, durable jobs and code sandboxes.
