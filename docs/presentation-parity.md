# Presentation and Image Studio parity contract

This inventory is the migration contract for the product currently maintained in
`document-generator-studio`. A milestone is not complete when a route merely
renders: the observable behavior below must remain available through the
platform product boundary.

## Presentation Studio

- Dashboard, blank creation, AI-assisted creation, outline review, live slide
  generation, autosave, duplication, deletion, and favorites.
- Plate-based slide editing, reordering, theme selection, custom themes,
  PowerPoint theme import, charts, diagrams, infographics, media, and rich text.
- Agent-assisted editing with staged tool calls, approval, cancellation,
  checkpointed resume, and preservation of the current presentation on failure.
- Presentation mode, public sharing and revocation, recording, and PPTX export.

## Image Studio

- FAL, Together AI, ComfyUI, and OpenAI-capable image profiles.
- Aspect ratio and model selection, durable upload, image history, and slide
  image replacement.
- Provider URLs must be validated and persisted before they become product
  assets.

## AI and terminal behavior

- Direct models provide streaming and structured output without product-level
  provider branches.
- LangChain is limited to chains, loaders, retrieval, and stream adaptation.
- LangGraph owns durable, interruptible, tool-using workflows.
- Codex and Claude Code run as agent jobs in isolated workers.
- New generation and refinement use a fresh workspace unless the selected
  profile explicitly permits resume.
- Invalid structured output receives one validation retry.
- Cancellation, timeout, runtime failure, validation failure, and publication
  failure preserve the previously published result.
- Publication is atomic and terminal/job progress remains observable.

## Representative fixtures

Parity tests must cover a blank presentation, an AI-generated presentation, a
custom theme, an imported theme, a diagram slide, an infographic slide, a
generated image slide, a shared presentation, and a recorded/exported
presentation.
