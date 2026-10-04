---
id: ADR-0016
title: "Run Active Session assistance on the worker executor with screenshots and two action slots"
status: Accepted
date: 2026-10-03
proposed_date: 2026-10-03
accepted_date: 2026-10-03
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0011]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [active-session, agents, screenshots, concurrency, live-ui]
related_briefs: []
related_research: []
governs:
  - domain: active-session
    rule: "Session actions reach agents only through the gateway's existing AgentExecutionPort, tool-less and structured; a runtime that cannot prove tool-less operation is refused, and Next.js never launches an agent."
    scope: apps/agent-worker, packages/ai-runtime, and products/interview/src/backend/live-session
    handle: ADR-0016/worker-local-tool-less-inference
    provenance: authored
  - domain: active-session
    rule: "A screenshot reaches a provider only as an owner-scoped, frozen, size- and dimension-bounded attachment on a runtime whose image input a test proves; otherwise the action is refused, never answered text-only."
    scope: products/interview/src/backend/live-session and packages/agent-runtime-*
    handle: ADR-0016/screenshot-attachments-fail-closed
    provenance: authored
  - domain: active-session
    rule: "Short assistance and coding hold separate slots, each with its own action, abort signal, and handle; a superseded revision is cancelled and its result is never published."
    scope: products/interview/src/backend/live-session
    handle: ADR-0016/two-action-slots-fenced
    provenance: authored
  - domain: active-session
    rule: "Owner input is a DB-only observation kind the capture wire cannot send, with its own source namespace, outside capture caps."
    scope: products/interview/src/backend/db and products/interview/src/backend/live-session
    handle: ADR-0016/owner-input-not-capture
    provenance: authored
  - domain: active-session
    rule: "Full, Focus, and floating views present one session store; the floating view is read-only, never controls the session, and closes on access loss."
    scope: products/interview/src/frontend/studio/live
    handle: ADR-0016/one-store-many-presentations
    provenance: authored
---

# ADR-0016 — Run Active Session assistance on the worker executor with screenshots and two action slots

## Context

ADR-0011 hosts the session processor in the agent worker; its gateway fills the existing `AgentExecutionPort` with `noAgents`, so Claude and Codex cannot serve live assistance. The processor stores screenshots but no model sees them, and the adapters advertise attachment support without forwarding images. One in-flight slot, one open action, and one shared abort signal serialize a new spoken question behind older coding work. The Live view has one presentation. ADR-0014 gives the worker the adapter lifecycle, one terminal outcome, and per-owner provider isolation; PB-0003 is still delivering the executor those rules describe. Design input: `bionic/inbox/active-session-unified-runtime-design.md`.

## Decision

Extend the existing processor; add no coordinator, queue, conversation store, or capture-wire change. Six independent parts, one ADR, delivered as the slices below.

1. **Runtime.** The worker implements the gateway's existing `AgentExecutionPort` for session actions; products keep calling `AiExecutionGateway`. The port re-checks session standing and locality after any capacity wait, and a tighten to device-only cancels in-flight remote runs, not only queued ones. Session actions use a tool-less profile; a `tool-started` event on this path is a typed failure, and a runtime that cannot prove tool-less operation is refused. Session-path errors carry typed codes, never provider text.
2. **Provider isolation.** Each action runs in an ephemeral per-attempt provider home with no persisted history. Until negative file-read tests prove ADR-0014's isolation, the session path stays on the direct-model backend.
3. **Screenshots.** `AiTask` gains attachments, and runtimes gain an image-input capability that an adapter fixture proves. Owner requests name observation ids only; the loader joins them to the owner's session, re-detects media type, checks the stored digest, and caps bytes and decoded dimensions from the header. Staged files live in a private per-attempt directory and are removed on settle, on startup sweep, and on purge with no model configured. Screen content is untrusted evidence.
4. **Owner input.** Analyze latest capture and typed follow-ups are one product-owned observation kind, stored DB-side only, with its own source namespace and exempt from capture caps. The capture wire cannot send it, and a negative ingest test says so. Task-revision provenance names the speech, snapshots, and owner input a revision rests on.
5. **Slots.** Assistance and coding hold separate slots, each with its own action, abort signal, and handle; idleness, quiescing, and shutdown consider both. A newer revision of a slot's task cancels that slot's work; fenced publication remains the correctness boundary. Live work is admitted ahead of background work, and background work cannot be starved indefinitely. The session pins one execution profile and version at start with no cross-provider fallback; the direct-model profile stays pinnable.
6. **Presentation.** The Live store feeds Full, Focus, and a floating Document Picture-in-Picture view with in-tab fallback. The float renders a read-only component set and unmounts on 401/404, membership loss, tenant switch, purge, end, and `pagehide`. Tests mock the Document Picture-in-Picture API; real-browser PiP is out of scope here.

**Delivery.** Slices 3 (slots) and 4 (presentation) are product code on current master, tested with the fake gateway. Slices 1–2 (runtime, screenshots) bind to PB-0003's executor and may only ship behind a disabled interim wrapper until it merges. Provider-backed tests are separate integration tests that name their required environment. Per-provider first-validated-answer latency is measured without logging content. A scope checkpoint is due before the change exceeds 1,000 lines; parts 5–6 may split into their own change.

## Alternatives Considered

### Option A — Import OpenCluely
- **Pros:** Existing screenshot interaction.
- **Cons:** A second app, capture stack, provider configuration, and conversation store.
- **Why not:** Duplicates capture, policy, and retention that the studio already owns.

### Option B — Route every session call through a new agent job
- **Pros:** Reuses the durable queue.
- **Cons:** Adds queue delay and a second result lifecycle.
- **Why not:** The session action is already durable, claimed, and fenced in the worker.

### Option C — OCR first, then classify, answer, and code in a chain
- **Pros:** Works without vision models.
- **Cons:** Serial calls and duplicated interpretation.
- **Why not:** Native image input fits the shared runtimes; local OCR remains a later opt-in.

## Consequences

**Positive:** Spoken, typed, and screenshot questions share one validated path on either provider. A correction is answered while older coding runs. Slots and presentation ship independently of the executor.

**Negative:** The processor gains slot and provenance state. Replay and deletion cover owner input and snapshot references. Provider-side retention differs from Studio purge and is described separately.

**Follow-on:** One transcript-plus-screenshot rehearsal per provider before claiming parity; rebinding to PB-0003's executor when it merges.

## References

- [[adrs/ADR-0011-host-the-active-session-processor-in-the-agent-worker]]
- [[adrs/ADR-0012-keep-active-session-data-private-to-the-actor-and]]
- [[adrs/ADR-0014-use-worker-owned-agent-sessions-with-one-terminal]]
- [[adrs/ADR-0007-route-ai-work-through-aiexecutiongateway-profiles]] (Proposed)
