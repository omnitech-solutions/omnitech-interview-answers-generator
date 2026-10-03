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

Products use language models, image models, multi-step workflows and coding
agents (Codex, Claude Code). Providers and models change often; agent runtimes
can touch a filesystem and run tools, so they are a security boundary; and
interview content (questions, code, notes, profiles) is private. The working
reference for choosing an execution boundary is
[[research/references/ai-execution-boundaries]].

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
   atomically after validation and approval.
6. **No content logging by default.** Prompts, questions, generated content
   and code, notes, attachments, credentials, source files, model responses and
   provider-native events are not logged by default.

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

## References

- `packages/ai-contracts/src/index.ts` and `packages/ai-runtime/src/index.ts` (gateway contract and profile resolution).
- `apps/agent-worker/src/` and `packages/agent-job-service/src/index.ts` (isolated agent execution and job lifecycle).
- Invariant checks [[invariants/checks/nextjs-never-launches-agent-processes]]
  and [[invariants/checks/products-never-branch-on-provider-names]].
- [[research/references/ai-execution-boundaries]]
