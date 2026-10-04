---
id: ADR-0019
title: "Host the overlay in a native shell through one host adapter"
status: Accepted
date: 2026-10-04
proposed_date: 2026-10-04
accepted_date: 2026-10-04
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0017, ADR-0018]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [active-session, overlay, native, macos, adapter, privacy]
related_briefs: []
related_research: []
governs:
  - domain: active-session
    rule: "A native shell hosts the one overlay route and fulfils host capabilities through the versioned studio-host contract; it owns no session state, creates no assist request and calls no model."
    scope: apps/studio-shell and packages/interview-contracts
    handle: ADR-0019/native-shell-hosts-the-one-route
    provenance: authored
  - domain: active-session
    rule: "A frame from a host adapter enters Studio only as the page's own post to the owner-authenticated capture route, so masking, locality, staleness and persistence stay Studio's."
    scope: products/interview/src/frontend/studio/live and apps/studio-shell
    handle: ADR-0019/host-frames-take-the-owner-route
    provenance: authored
  - domain: active-session
    rule: "A shell window keeps the default screen-capture sharing type, offers no hiding or disguise, and states that it is visible."
    scope: apps/studio-shell
    handle: ADR-0019/shell-no-concealment
    provenance: authored
  - domain: active-session
    rule: "A shell stores a pairing credential only in the Keychain, never sends or logs it, and loads only Studio's own origin in its web view."
    scope: apps/studio-shell
    handle: ADR-0019/shell-credential-in-keychain
    provenance: authored
---

# ADR-0019 — Host the overlay in a native shell through one host adapter

## Context

ADR-0017 made the overlay one route any host can load and left a native always-on-top shell as a follow-on; ADR-0018 asked for the same. A browser cannot capture the window in focus, and cannot keep a card above a full-screen interview window. The person also wants Studio installable the way a browser offers "Install app".

## Decision

1. **Two hosts of one route.** An installable web app (a manifest naming the overlay route; no service worker, as the browser needs none to install) and a native macOS shell both load the overlay route from ADR-0017. The shell is an accessory app with a menu-bar item, so pressing its floating window leaves the interview window frontmost.
2. **One host adapter.** The shell injects `window.studioHost`, a versioned contract owned by `packages/interview-contracts` (`studio-host`). Studio negotiates it and offers "This Mac (native)" only when it is present; the browser's own capture is otherwise unchanged. The shell fulfils capture by reusing the capture companion's one-shot module and returns the image to the page.
3. **Studio stays the owner of logic.** The page posts the returned image to the existing owner capture route (ADR-0018). The shell never creates an assist request. Its menu actions call routes Studio already serves its own page, from inside the web view, with the person's own sign-in.
4. **No concealment.** The window states "Visible window · shows in screen shares" and keeps the default sharing type (ADR-0018).
5. **Credentials.** The shell stores an optional pairing credential in the Keychain where the companion does and never sends it; its web view loads Studio's origin only and opens other links in the browser.

## Alternatives Considered

### Option A — Electron
- **Pros:** Familiar; one JavaScript stack.
- **Cons:** A runtime and updater to own; a second capture path beside ScreenCaptureKit.
- **Why not:** The capture code already exists in Swift and needs only a thin host.

### Option B — Let the shell call Studio's APIs and create analyses
- **Pros:** Works without the page.
- **Cons:** A second implementation of masking and locality.
- **Why not:** It breaks ADR-0018's rule that the companion fulfils and never creates.

## Consequences

**Positive:** Focused-window capture and a pinned card without a second Studio. The web app install is a manifest.

**Negative:** The shell is ad-hoc signed in development, so macOS asks for Screen Recording again after a rebuild. The native source has no live preview.

**Follow-on:** A signed, notarised release; Windows and Linux shells would implement the same contract.

## References

- [[adrs/ADR-0017-host-the-active-session-overlay-as-one-route-and-isolate-providers]]
- [[adrs/ADR-0018-capture-on-demand-with-masks-and-owner-requested-companion-captures]]
