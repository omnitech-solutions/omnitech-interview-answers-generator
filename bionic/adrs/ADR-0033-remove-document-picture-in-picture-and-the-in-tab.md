---
id: ADR-0033
title: "Remove Document Picture-in-Picture and the in-tab overlay card; the native shell is the live-session surface"
status: Proposed
date: 2026-10-06
proposed_date: 2026-10-06
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0017]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [active-session, overlay, pip, native, live-ui]
related_briefs: []
related_research: []
governs: []
---

# ADR-0033 — Remove Document Picture-in-Picture and the in-tab overlay card; the native shell is the live-session surface

## Context

ADR-0017 made the Active Session overlay one route that every host loads, and named the Document Picture-in-Picture window and the in-tab card among those hosts. The native shell now hosts the panels (the compact window and Settings) on that same route, and the owner uses only the native app during a live session. The web card, its floating host, and the web hands-free band are therefore unused surface that still has to be kept working, tested, and styled.

The removal must not take away what the Studio live page is for: reading the session, controlling it, and reviewing it afterwards.

## Decision

The native shell is the only live-session surface that floats above other windows.

- The Document Picture-in-Picture float and the in-tab overlay card, with their hosts, controls, and styles, no longer exist.
- The overlay route serves the native shell's panels only. A browser tab that lands on it is sent to the Studio live page.
- The Studio live page keeps the session bar (state, sources, Pause or Resume, End), the task panels, the Transcript, Activity and Sources tabs, the screenshots tray, the revisions control, and the ended summary.
- The shared pieces the native panels and the live page still use remain: the hands-free controller, the presentation state (pinned task, chosen revision), the footer, the code canvas, and the access rules.
- The installed web app opens the Studio live page, not the overlay route.

## Alternatives Considered

### Option A — Keep Picture-in-Picture only
- **Pros:** a floating card in a browser for people without the Mac app.
- **Cons:** keeps the card, its host, and the route's second code path alive for one host.
- **Why not:** the owner does not use it; the native window is the floating surface.

### Option B — Keep both
- **Pros:** nothing is lost.
- **Cons:** two implementations of one session experience to test and keep consistent.
- **Why not:** the cost buys no current user.

## Consequences

**Positive:**
- One live-session experience to build and test; the overlay route has one host.

**Negative:**
- The owner loses a floating card in a browser. The web live page has no follow-up box, no Manual and Auto switch, and no capture strip; capture there is the screenshots tray.
- The missing-context strip's "Add context" is disabled on the web page, with the reason shown; the native chat answers it.

**Follow-on work:**
- ADR-0017's rule that the card is the route every host loads is superseded in effect; its `governs` entry is not changed by this ADR.
- The hands-free controller keeps state that only the removed card used; trim it when its remaining consumers are settled.

## References

- [[adrs/ADR-0017-host-the-active-session-overlay-as-one-route-and-isolate-providers]]
