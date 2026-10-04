---
id: ADR-0021
title: "Negotiate companion capture requests and report their failures"
status: Proposed
date: 2026-10-04
proposed_date: 2026-10-04
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0018]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [active-session, companion, wire, negotiation, capture]
related_briefs: []
related_research: []
---

# ADR-0021 — Negotiate companion capture requests and report their failures

## Context

ADR-0018 put the pending capture request on `control.capture` and accepted that an older companion rejects it. The acknowledgement objects are strict, so a new field is not additive for a strict reader, and authority-bearing objects must stay strict. Review of the shipped feature also found that a snapshot naming a dead request was stored before its standing was checked, that a mask could outlive the source it was drawn on, that the companion's focus is read after the owner's press moved it, and that a capture the companion could not take was only discovered at expiry.

## Decision

1. **Negotiation.** A companion declares what it understands in request headers outside the strict bodies (`x-companion-features`, `x-companion-screen`). Studio emits `control.capture` only to a request that declared `capture-request.v1`, and records the declaration with the owner's capability row. A known companion that did not declare it gets a refused request with reason `companion_update_required`. Strict objects stay strict; an older Studio ignores the headers.
2. **Request semantics.** The companion-facing request carries its deadline (`expiresAt`); the companion captures nothing at or after it. A region is bound to the companion's screen selection (display identity plus a generation that changes on every screen start); a request bound to another selection is refused by Studio (`source_changed`) or failed by the companion (`source-changed`), never cropped. The focused window is sampled when the companion takes the request from an acknowledgement, not at capture time and not at the press.
3. **Standing before retention.** A screenshot naming a `requestId` that is not the session's pending, unexpired request is refused (`capture_request_stale`) before anything is stored. A screenshot with no `requestId` is unchanged.
4. **Failure reaches the requester.** The companion reports a capture it cannot take as one bounded `capture.failure` message (closed code, correlated by request id, sent only after it was handed a request). The owner's request state becomes `failed` with that code at once.

## Alternatives Considered

### Option A — Make the control objects permissive
- **Cons:** A permissive authority-bearing object accepts fields no one validated.
- **Why not:** Negotiation keeps strict readers strict.

### Option B — Declare support in the capability report body
- **Cons:** The report is itself strict, so a newer companion would be refused by an older Studio.
- **Why not:** Headers work in both directions.

## Consequences

**Positive:** An older companion and an older Studio both keep working; a dead or foreign request can no longer leave an image behind; the owner hears a failure within a heartbeat.

**Negative:** Focus is sampled when the request is taken, so a shell that activates its own window on the press can still be the frontmost application then; the shell must present non-activating. Two columns join the capability row.

## References

- [[adrs/ADR-0018-capture-on-demand-with-masks-and-owner-requested-companion-captures]]
