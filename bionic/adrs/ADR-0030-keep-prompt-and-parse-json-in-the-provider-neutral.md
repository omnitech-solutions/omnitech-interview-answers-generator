---
id: ADR-0030
title: "Keep prompt-and-parse JSON in the provider-neutral direct Anthropic adapter"
status: Proposed
date: 2026-10-05
proposed_date: 2026-10-05
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: []
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [ai, anthropic, adapters, structured-output]
related_briefs: []
related_research: []
---

# ADR-0030 — Keep prompt-and-parse JSON in the provider-neutral direct Anthropic adapter

<!-- BODY CONTENT RULE — see bionic/AGENTS.md section 11.D. -->

## Context

Anthropic recommends native structured outputs over asking for JSON and parsing it. The direct Anthropic adapter asks for JSON by prompt, validates it against the caller's schema and retries once with a repair prompt. The Claude Agent SDK path already uses a native JSON-schema output format. The audit finding is AN-ARC-02 in `bionic/inbox/audit/technology-consistency.md`. [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]] makes the gateway provider-neutral and adapters thin; [[adrs/ADR-0002-simplicity-first-the-least-complex-design-that-mee]] asks for the least complex design.

## Decision

1. **The direct adapter keeps prompt-and-parse.** A structured-generation request is satisfied by instructing the model, validating the result against the request's schema, and one repair retry that names the validation failure. A second failure is reported as a failure.
2. **The contract stays provider-neutral.** The gateway's structured-generation contract does not expose a provider-native schema mechanism, and no product depends on one.
3. **Revisit on evidence.** Native structured output is reconsidered when the repair path is measured to cost latency or failures that matter, or when a second provider offers an equivalent mechanism the gateway can express neutrally.

## Alternatives Considered

### Option A — Native structured outputs in the Anthropic adapter
- **Pros:** fewer failure paths and less latency.
- **Cons:** a provider-specific schema subset in one adapter; behaviour diverges from the other adapters.
- **Why not:** it adds a provider-specific path for a gain that is not measured; rule 1 favours the simpler shape.

## Consequences

**Positive:**
- One structured-output behaviour across adapters; no provider-specific schema constraints.

**Negative:**
- An extra request when the first answer does not parse; more failure paths than native output.

## References

- `packages/ai-provider-anthropic/src/index.ts` and its structured-output parser.
- `packages/ai-contracts/src/index.ts` (`ModelProviderAdapter`).
- `packages/agent-runtime-claude/src/index.ts` (the agent path's native output format).
- `bionic/inbox/audit/technology-consistency.md` (AN-ARC-02).
