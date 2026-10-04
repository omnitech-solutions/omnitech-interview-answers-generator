---
id: ADR-0017
title: "Host the Active Session overlay as one route and isolate providers without emptying their home"
status: Accepted
date: 2026-10-03
proposed_date: 2026-10-03
accepted_date: 2026-10-03
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0016]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [active-session, overlay, pip, agents, isolation, structured-output]
related_briefs: []
related_research: []
governs:
  - domain: active-session
    rule: "The overlay card is one self-contained route that every host loads (the PiP window, the in-tab card, a standalone window, a native web view); a host adds no second implementation."
    scope: products/interview/src/frontend/studio/live
    handle: ADR-0017/one-overlay-route-any-host
    provenance: authored
  - domain: active-session
    rule: "A session attempt keeps no provider history and gives the model no tools or shared host state, by capability: Claude by no tools, no persistence and no settings, Codex by a per-attempt home holding only a private copy of its sign-in."
    scope: apps/agent-worker and packages/agent-runtime-*
    handle: ADR-0017/provider-isolation-by-capability
    provenance: authored
  - domain: agent-runtime
    rule: "A vendor's structured-output constraints are met inside the adapter that needs them: the product schema is unchanged and the answer is converted back."
    scope: packages/agent-runtime-codex
    handle: ADR-0017/vendor-schema-stays-in-the-adapter
    provenance: authored
---

# ADR-0017 — Host the Active Session overlay as one route and isolate providers without emptying their home

## Context

ADR-0016 shipped behind fakes. Running Claude, Codex, the Docker runner, and Document Picture-in-Picture for real showed three of its choices cannot hold as written. An empty per-attempt provider home removes the local sign-in both providers use. A PiP view rendered by the live page's own scripts goes stale when that page is a background tab, and it cannot serve a native window. Codex's structured-output mode rejects the coding schema because it has an optional field; Claude's accepts it.

## Decision

1. **One overlay route.** The overlay card is a self-contained route with its own store, polling, session switcher, and access-loss handling. The PiP window loads it, the in-tab card renders the same component, and a standalone window or native web view can load the same URL. The in-tab card persists across Studio pages. The card has compact and maximized sizes; closing the float returns to the previous presentation. Navigation intents from the overlay reach the Studio tab over a same-origin channel and carry no session control.
2. **Isolation by capability.** ADR-0016's postcondition stands: an attempt keeps no provider history and the model gets no tools or shared host state. The mechanism changes. Claude runs with no tools, no session persistence, and no settings sources, and keeps its normal sign-in. Codex runs in a per-attempt home holding only a private copy of its sign-in, removed with the attempt. A pooled provider query is never reused across a request that carries attachments or runs tool-less.
3. **Structured-output turns.** A tool-less structured answer is allowed several turns, because the provider rejects a malformed structured-output call and asks again; the profile's own timeout still bounds the run.
4. **Vendor schema in the adapter.** The Codex adapter converts a product schema to the vendor's strict form (every property required, optional ones nullable, no extra keys) and removes the nulls it added from the answer. Product schemas and Claude's behavior do not change.

## Alternatives Considered

### Option A — Keep the empty provider home
- **Pros:** Strongest isolation by construction.
- **Cons:** Neither provider can sign in; the path never runs.
- **Why not:** A control that disables the feature is not isolation.

### Option B — Make the product schemas strict
- **Pros:** No adapter conversion.
- **Cons:** Every optional field becomes nullable for every provider and every validator.
- **Why not:** One vendor's constraint should not reshape the product contract.

### Option C — Keep the portal-rendered float
- **Pros:** One document, less to load.
- **Cons:** Stale when the opener is hidden; unusable by a native window; copies styles.
- **Why not:** The route already exists and serves every host.

## Consequences

**Positive:** The overlay works over any tab and in any host. Both providers run the real flow. The product schemas stay provider-neutral.

**Negative:** Codex's sign-in is copied per attempt, so a token refreshed inside the copy is lost with it. Codex cannot disable its tools, so the adapter aborts on the first tool event under a read-only sandbox.

**Follow-on:** A native always-on-top shell and an extension are separate decisions; both would load the route above.

## References

- [[adrs/ADR-0016-run-active-session-assistance-on-the-worker-executor]]
- [[adrs/ADR-0014-use-worker-owned-agent-sessions-with-one-terminal]]
- [[adrs/ADR-0013-pause-rather-than-end-an-active-session-on-credent]]
