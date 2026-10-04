---
id: ADR-0018
title: "Capture on demand with masks and owner-requested companion captures"
status: Accepted
date: 2026-10-04
proposed_date: 2026-10-04
accepted_date: 2026-10-04
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0016]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [active-session, capture, privacy, companion, overlay]
related_briefs: []
related_research: []
governs:
  - domain: active-session
    rule: "Analyze examines a frame taken when the owner presses it, never a stored older one; a frame the owner supplies or requests enters the session only through an owner-authenticated route."
    scope: products/interview/src/backend/live-session and products/interview/src/frontend/studio/live
    handle: ADR-0018/analyze-captures-fresh
    provenance: authored
  - domain: active-session
    rule: "A capture region is applied where the frame is taken, in the browser or in the companion, so pixels outside it never leave the device."
    scope: products/interview/src/frontend/studio/live and apps/capture-companion
    handle: ADR-0018/mask-applied-before-send
    provenance: authored
  - domain: active-session
    rule: "A companion credential may fulfil a pending capture request the owner made but can neither create nor widen one; an analysis exists only because the owner asked for it."
    scope: products/interview/src/backend/live-session and packages/active-session-contracts
    handle: ADR-0018/companion-fulfils-never-creates
    provenance: authored
  - domain: active-session
    rule: "The overlay has no mode that hides it from, or disguises it for, other participants' screen capture; it states that it is visible."
    scope: products/interview/src/frontend/studio/live and apps/capture-companion
    handle: ADR-0018/no-concealment
    provenance: authored
---

# ADR-0018 — Capture on demand with masks and owner-requested companion captures

## Context

ADR-0016's Analyze re-sent the latest frame the companion happened to deliver, possibly long stale, and the mic and screen indicators were status lights with nothing behind them. The owner wants Analyze to look at what is on screen now: the window in focus by default, or a region they choose. The companion's control channel carried only session-level pause and resume, and only the owner's own screen capture could not reach the session at all.

## Decision

1. **Fresh capture.** Analyze takes a frame at the moment of the press. A frame comes from one of two sources: the owner's browser, through a window, tab, or screen the owner picked, or the companion, through a one-shot capture the owner requested. Each enters the session through an owner-authenticated route that stores the frame as the session's private screenshot, then records the analysis that references it, in one transaction.
2. **Mask before send.** A capture region is a rectangle normalised to the captured surface. The browser applies it before encoding, and the companion applies it before encoding. A frame is also bounded in size and dimensions, labelled by kind and never by title.
3. **Capture requests.** The owner's request names a mode (focused window, region, or display) and is held as one short-lived pending request per session. The companion learns of it only through the control state it already receives, captures once, and answers with an ordinary screenshot tagged with the request id. Only an exact match to the pending, unexpired request turns that screenshot into an analysis. A companion credential cannot create a request or an analysis, and a focused-window request never falls back to the whole display.
4. **Controls.** The mic and screen indicators open their real state, the exact reason for any loss, and the fix; the owner's own dictation and source choice are controls in the overlay. Skill and coding-language hints are an enum the owner sets, sent as constant policy sentences and never free text.
5. **No concealment.** The overlay does not hide itself from other participants' screen capture and does not disguise itself. It states that it is visible.

## Alternatives Considered

### Option A — Keep analysing the companion's latest frame
- **Pros:** No new routes or wire fields.
- **Cons:** The frame can be stale and the owner cannot choose what is analysed.
- **Why not:** It answers a different question than the one the owner asked.

### Option B — Only the browser captures
- **Pros:** No native change.
- **Cons:** The browser cannot see which window has focus.
- **Why not:** Focused-window capture is what the owner asked for by default.

### Option C — A stealth overlay that hides from screen capture
- **Pros:** Matches products that advertise it.
- **Cons:** It hides the assistant from the other people in the interview.
- **Why not:** Studio's consent model asks that everyone has agreed; concealment defeats it.

## Consequences

**Positive:** Analyze examines what the owner is looking at, and a mask keeps unrelated screen content on the device. A companion cannot be turned into a way to analyse the screen unprompted.

**Negative:** The companion polls faster while a screen source runs. An older companion build rejects acknowledgements that carry a capture request. Real Screen Recording permission is still the owner's to grant.

**Follow-on:** Observe a real focused-window capture on a Mac; consider a native always-on-top host for the overlay route.

## References

- [[adrs/ADR-0016-run-active-session-assistance-on-the-worker-executor]]
- [[adrs/ADR-0017-host-the-active-session-overlay-as-one-route-and-isolate-providers]]
- [[adrs/ADR-0013-pause-rather-than-end-an-active-session-on-credent]]
