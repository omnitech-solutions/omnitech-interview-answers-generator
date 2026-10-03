---
id: ADR-0007
title: "Route AI work through AiExecutionGateway profiles and run agents only in the isolated worker"
status: Proposed
date: 2026-10-02
proposed_date: 2026-10-02
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: []
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [ai, execution, agents, privacy, langchain, langgraph]
related_briefs: []
related_research: [references/ai-execution-boundaries]
---

# ADR-0007 — Route AI work through AiExecutionGateway profiles and run agents only in the isolated worker

## Context

Retroactive record of rules already in force, stated in the former
`.rulesync/rules/ai-execution.md`, the former `docs/ai-execution-policy.md`,
the AI rows of the former `.rulesync/rules/packages.md`, and the logging rule
of the former `.rulesync/rules/base.md` — all commit `4c50c5e`; the working
reference is [[research/references/ai-execution-boundaries]].

Products use language models, image models, multi-step workflows and coding
agents (Codex, Claude Code). Providers and models change often; agent runtimes
can touch a filesystem and run tools, so they are a security boundary; and
interview content (questions, code, notes, profiles) is private.

## Decision

1. **Profiles, not vendors.** Products call `AiExecutionGateway` with a stable
   profile or capability. Product code never branches on a provider or model
   name. Provider-native objects stay private to their adapter package; the
   platform persists normalized usage and failure metadata.
2. **Two adapter kinds.** Stateless language and image APIs implement provider
   adapters (`ai-provider-*`). Codex and Claude Code implement
   `AgentRuntimeAdapter` (`agent-runtime-*`) and run only in the isolated agent
   worker (`agent-worker`), whose durable job lifecycle `agent-job-service`
   owns.
3. **Next.js never launches agents.** Next.js may create, inspect, cancel and
   resume agent jobs. It never launches an agent process.
4. **Bounded agent profiles.** Agent profiles are typed, versioned, centrally
   configured and bounded. User input never supplies raw CLI arguments,
   arbitrary environment variables, arbitrary directories, arbitrary MCP
   servers, or permission bypasses.
5. **Execution style by need.** Direct model execution serves one-shot,
   structured, streaming and image tasks. LangChain (`ai-workflow-*`) serves
   loaders, retrieval, prompt chains and stream adaptation. LangGraph serves
   only durable, interruptible, tool-using workflows, and its mutations are
   idempotent; product changes from a workflow are staged and applied
   atomically after validation and approval. The boundary table is in
   [[research/references/ai-execution-boundaries]].
6. **No content logging by default.** Prompts, questions, generated content
   and code, notes, attachments, credentials, source files, model responses and
   provider-native events are not logged by default.

## Alternatives Considered

### Option A — Products call provider SDKs directly
- **Pros:** No gateway indirection; full access to provider features.
- **Cons:** Provider names and SDK objects spread through product code; a
  model swap becomes a product change.
- **Why not:** Profiles let configuration, not code, choose the model.

### Option B — Run agent processes inside the Next.js server
- **Pros:** Simpler deployment; no job queue.
- **Cons:** Tool-using agents share the web process's filesystem, environment
  and credentials; a runaway agent degrades every request.
- **Why not:** The worker isolates agent execution from the web tier.

### Option C — LangGraph for every AI call
- **Pros:** One programming model.
- **Cons:** Checkpointing and graph state for stateless calls add cost and
  complexity ([[adrs/ADR-0002-choose-the-smallest-architecture-option-that-satis]]).
- **Why not:** Durable workflow machinery is reserved for durable workflows.

## Consequences

**Positive:**
- Models and providers change by configuration; product code is stable.
- Agent execution is isolated, bounded and resumable.
- Private interview content stays out of logs.

**Negative:**
- Debugging without content logs needs normalized metadata and explicit
  opt-in tracing.
- A new provider feature must be expressed through the gateway contract
  before a product can use it.

**Follow-on work:**
- Invariant candidates pin "Next.js never launches an agent process" and "no
  provider/model branching in product code" (see `bionic/invariants/`).

## References

- [[research/references/ai-execution-boundaries]]
- Former `.rulesync/rules/ai-execution.md`, `.rulesync/rules/packages.md` and `.rulesync/rules/base.md` (commit `4c50c5e`).
