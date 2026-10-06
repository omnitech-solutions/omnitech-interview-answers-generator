---
id: ADR-0028
title: "Pass pointer events through only the transparent regions of the see-through window"
status: Proposed
date: 2026-10-05
proposed_date: 2026-10-05
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0019]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [active-session, overlay, native, macos, presentation]
related_briefs: []
related_research: []
---

# ADR-0028 — Pass pointer events through only the transparent regions of the see-through window

<!-- BODY CONTENT RULE — see bionic/AGENTS.md section 11.D. -->

## Context

The overlay floats above the interview. The owner needs to read through it and to click what is beneath it, while keeping every visible control reachable so the mode can always be turned off. Earlier there were three screen-like toolbar icons (capture, screen picker, click-through) and a click-through mode that trapped the toolbar.

Source of the decision: plan section on the T33 owner confirmation and its WIRE and SHELL notes in `bionic/inbox/redesign/plan.md` (owner confirmed 2026-10-05).

## Decision

1. **One See-through control.** It turns on clear glass and region-based pass-through together; the keyboard shortcut and the menu-bar item toggle the same control. The separate click-through and transparent-background controls do not exist.
2. **Only transparent regions pass events.** Anything the owner can see and use stays interactive: the toolbar and its buttons, panes, cards, menus, toasts, the footer and the image viewer. Empty glass passes clicks and scrolls to the window beneath.
3. **The page owns the regions, the shell enforces them.** The page reports its interactive rectangles through a `hit-regions` host capability over the host bridge (a published interface, so the wire is part of the decision): a bounded list of rectangles, an empty list meaning everything passes through, and none meaning the whole window is interactive. Any other shape is refused.
4. **Fail interactive.** The shell returns the whole window to interactive on a null report, on a stale report (a lease of 15 seconds), when the window is hidden and when the app terminates. The native top strip that drags the window stays interactive. A decision is left alone while a mouse button is down.
5. **Not reset on deactivation.** Passing a click to the window beneath deactivates the app, so deactivation does not end pass-through.

## Alternatives Considered

### Option A — Toolbars interactive, content area passes through
- **Pros:** trivial and robust.
- **Cons:** blocks clicks on panes the owner can see; coarse.
- **Why not:** kept only as the accepted fallback if regions proved infeasible; regions proved feasible.

### Option B — Separate click-through and transparency controls
- **Pros:** each does one thing.
- **Cons:** confusing icons; click-through trapped the toolbar.
- **Why not:** the owner confirmed one merged control.

## Consequences

**Positive:**
- The owner can read and click through the overlay without losing the controls.

**Negative:**
- Pass-through over a real browser, the toolbar staying clickable, the 15-second safety, a global mouse monitor needing no permission prompt, and dragging across the window are not proven here and need live checks on the real app.
- Global mouse monitors depend on platform behaviour documented as needing no Accessibility permission; this is unverified live.

## References

- `bionic/inbox/redesign/plan.md` (T33, D33 and the see-through notes).
- `packages/interview-contracts/src/studio-host.ts` (`presentation` bridge method, `hit-regions` capability).
- `apps/studio-shell/Sources/StudioShellCore/HostBridge.swift` and the shell's hit-region tracker.
- [[adrs/ADR-0019-host-the-overlay-in-a-native-shell-through-one-host-adapter]]
