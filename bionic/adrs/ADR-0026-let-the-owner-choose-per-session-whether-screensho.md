---
id: ADR-0026
title: "Let the owner choose per session whether screenshots are sent to the model as images"
status: Proposed
date: 2026-10-05
proposed_date: 2026-10-05
accepted_date: null
deprecated_date: null
superseded_date: null
supersedes: []
amends: [ADR-0016]
superseded_by: null
deciders: ["Desmond O'Leary"]
tags: [active-session, screenshots, privacy, ocr, settings]
related_briefs: []
related_research: []
---

# ADR-0026 — Let the owner choose per session whether screenshots are sent to the model as images

<!-- BODY CONTENT RULE — see bionic/AGENTS.md section 11.D. -->

## Context

Sending the image, the recognised text, or neither are different privacy positions. Most screens that are only text lose nothing when sent as text, but a screen with code layout, a diagram or an unreadable region needs the image. The owner must be able to see what left the device.

Source of the decision: plan decision D35 in `bionic/inbox/redesign/plan.md` (accepted by the owner on 2026-10-05). Depends on the on-device recognition ADR.

## Decision

1. **A per-session setting "Screenshots to the model" with three modes.** Always send (the default: image plus recognised text), Text only when the screen is just text, and Never send images (the device-only behaviour). The setting is stored with the session and is the same on every surface.
2. **Text-only is a gate that fails toward sending the image.** In Auto and Manual, the image is dropped only when recognition succeeded, the recognised text covers most of the frame, confidence is high, no non-text region is left uncovered, and the content is not code whose layout matters. Code frames always keep the image. Missing or doubtful measurements send the image. The thresholds are named constants in one place.
3. **The owner can see what left the device.** Each task row and the transcript state whether a screenshot was "sent as text only" or whether the "image sent".
4. **Blurring regions before send** is a later option and is not built.

## Alternatives Considered

### Option A — Always send the image
- **Pros:** simplest; best fidelity.
- **Cons:** no way to keep a text-only screen as text.
- **Why not:** the owner asked for the choice; Always is kept as the default.

### Option B — Decide automatically with no setting
- **Pros:** no UI.
- **Cons:** the owner cannot predict or audit what is sent.
- **Why not:** it hides a privacy decision.

## Consequences

**Positive:**
- A visible, auditable privacy control; text-only screens need not leave as images.

**Negative:**
- The gate thresholds are judgement calls and are validated only against fixtures, not real screens.

## References

- `bionic/inbox/redesign/plan.md` decision D35.
- `products/interview/src/backend/db/live-session.ts` (`screenshotSendModes`) and `packages/interview-contracts/src/live-session.ts` (`liveScreenshotSendSchema`).
- The gate's named threshold constants (`IMAGE_GATE_THRESHOLDS`) are the source of truth for the numbers.
