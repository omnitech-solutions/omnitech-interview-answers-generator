---
id: ADR-0025
title: "Recognise screenshot text on the device before any screenshot reaches the model"
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
tags: [active-session, ocr, screenshots, privacy]
related_briefs: []
related_research: []
---

# ADR-0025 — Recognise screenshot text on the device before any screenshot reaches the model

<!-- BODY CONTENT RULE — see bionic/AGENTS.md section 11.D. -->

## Context

A model reading a screenshot can misread exact text and numbers, and it cannot tell that a problem statement is cut off at the edge of the frame. Recognising the text on the device gives the model exact characters and gives the app a mechanical cut-off signal, and it is the groundwork for a device-only analysis path. The recognised text is content from the owner's screen and carries the same privacy duties as the screenshot.

Source of the decision: plan decision D31 in `bionic/inbox/redesign/plan.md` (owner directive of 2026-10-05; chosen: on-device first, text plus image).

## Decision

1. **Every screenshot is recognised on the device first.** Recognition runs before upload, on the final bytes of the image, so a crop made on the page is recognised again after the crop.
2. **One port, two adapters.** The page uses one text-recognition port. The native shell serves it with Apple Vision through a bridge operation, and the browser serves it with a locally bundled WebAssembly OCR whose assets come from the app's own origin, loaded lazily and never from a CDN. When no recogniser is available the state is explicit and the image goes alone.
3. **The text travels with the image.** Each upload carries bounded recognised text. The server stores it with the screenshot observation under the same retention and purge, and never logs it.
4. **The model is told what the text is.** The model call carries each screenshot's text labelled as machine-read on-screen text that may contain errors, next to the image. A mechanical cut-off hint (text ends mid-sentence, unbalanced brackets) goes into the prompt as a hint only, never as a verdict.
5. **Device-only sessions still do not analyse screenshots.** Text-only on-device analysis is a future option and is not built.

## Alternatives Considered

### Option A — Recognise on the server
- **Pros:** one implementation.
- **Cons:** the screenshot must leave the device before anything is known about it.
- **Why not:** it defeats the privacy purpose.

### Option B — Rely on the model's own reading
- **Pros:** no OCR component.
- **Cons:** inexact text and numbers; no cut-off signal.
- **Why not:** the owner asked for exact text and a mechanical cut-off signal.

### Option C — A CDN-hosted OCR bundle in the browser
- **Pros:** smaller app.
- **Cons:** a third-party origin sees the page and loads code at runtime.
- **Why not:** assets are served from the app's own origin.

## Consequences

**Positive:**
- The model receives exact text; the app can gate image sending on recognition quality (see the screenshots-to-model ADR).

**Negative:**
- Two recognisers to keep in step; browser recognition adds a worker and a WebAssembly payload.
- Recognition accuracy and latency on the real native and browser engines are not proven here.

## References

- `bionic/inbox/redesign/plan.md` decision D31.
- `products/interview/src/frontend/studio/live/shared/text-recognizer.ts`, `native-recognizer.ts`, `wasm-recognizer.ts`.
- `apps/studio-shell/Sources/StudioShellCore/TextRecognition.swift` and the `recognizeText` operation in `HostBridge.swift`.
