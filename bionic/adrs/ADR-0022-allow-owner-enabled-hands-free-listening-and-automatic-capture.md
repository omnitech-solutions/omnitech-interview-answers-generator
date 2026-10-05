---
id: ADR-0022
title: "Allow owner-enabled hands-free listening and automatic capture"
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
tags: [active-session, overlay, capture, privacy, hands-free]
related_briefs: []
related_research: []
---

# ADR-0022 — Allow owner-enabled hands-free listening and automatic capture

## Context

ADR-0018 requires that an analysis examines a frame taken when the owner presses Analyze, and that the overlay hides nothing. During a live interview the owner cannot touch the keyboard or mouse, so every press (capture, dictation, re-share, resume) is a failure of the product. The owner has asked for one setup, after which nothing more is needed.

## Decision

1. **Auto is the owner's, visible and stoppable.** Hands-free mode ("Auto") exists only while the owner has turned it on, in the overlay or through Start hands-free. While on, the card always says so in one line and one click turns it off. It defaults on for a new session only after the owner has turned it on before, remembered in that browser. The footer still states that the window is visible in screen shares.
2. **Automatic capture replaces the press, not the route.** While Auto is on and a screen is shared, the browser samples the shared picture on an interval (default 8 s, clamped to 3-30 s by the owner's setting) and hashes the sample on the device. A frame is analysed only when it is the first, or its hash differs from the last analysed frame by at least the change threshold (4 of 64 bits); an optional heartbeat (off by default) re-analyses an unchanged screen after 60 s. The interval, threshold and heartbeat live in one place, `overlay/auto-interval.ts`. The earlier design in this ADR, a change-and-settle detector that waited for the picture to change and then hold still, is not what ships: the interval-and-hash rule above replaced it. The frame is taken, masked and sent exactly as a press would: the owner's region applies before encoding, and the frame enters only through the owner-authenticated capture route. A sample is used for change detection only; it is never stored or sent.
3. **Limits.** At least 15 seconds between automatic analyses and at most 120 per session (`overlay/auto-gate.ts`, the one place both limits are set); none while paused or ended, while a capture is in flight, or in a session that refuses screenshots. Each automatic capture is labelled as automatic in the transcript and Activity, and counts toward the session's capture cap. Where a limit stops Auto, the card says which.
4. **Heard speech without a button.** While Auto is on, the owner's browser listens continuously and each final phrase is sent to the owner input route as bounded text. The server stores it as a transcript segment from a reserved owner-microphone source, so the processor reads it as it reads a companion transcript. That source is reserved against the capture wire, subject to the same lock-time checks as other owner input, takes nothing while the session is paused, and is idempotent by request id. In a device-only session recognition must run on the device or listening is refused.
5. **No lost sessions.** A lost share, a refused microphone or a paused session shows one plain line naming the one action needed; a browser requires a click to share a screen again, and the line says so. A session pauses for reasons other than the owner's own pause only when something outside the owner's hands stopped it; Auto resumes such a session from the tab the owner is looking at, and never one the owner paused.
6. **Audio from other tabs or calls is out of scope.** The browser recogniser hears the microphone only. Audio from a call or tab needs the native companion; nothing in the browser pretends otherwise.

## Alternatives Considered

### Option A — Keep every capture a press
- **Pros:** The strictest reading of ADR-0018.
- **Cons:** The owner cannot use the product in the moment it exists for.
- **Why not:** The press is the owner's consent; an owner-set mode that is visible and stoppable preserves it.

### Option B — Capture on a timer
- **Pros:** Simple.
- **Cons:** Analyses an unchanged screen, spending the capture cap and the model on nothing.
- **Why not:** Change detection costs a few hundred bytes of local arithmetic.

### Option C — Send heard text as the owner's typed follow-up
- **Pros:** No new input kind.
- **Cons:** A question the interviewer asks would revise the last task instead of opening one.
- **Why not:** Heard speech has to reach the task policy as speech.

## Consequences

**Positive:** One setup, then no presses. Everything automatic is visible, bounded and stoppable.

**Negative:** The microphone hears the room, so the owner's own questions to themselves can open a task; speech is not attributed to a person. A change of screen can open a new task rather than revise the last one.

**Follow-on:** Observe a real interview-length run; consider attaching an automatic capture to the task it continues.

## References

- [[adrs/ADR-0018-capture-on-demand-with-masks-and-owner-requested-companion-captures]]
- [[adrs/ADR-0016-run-active-session-assistance-on-the-worker-executor]]
