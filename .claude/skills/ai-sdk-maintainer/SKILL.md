---
name: ai-sdk-maintainer
description: >-
  Add or change AI providers while preserving the provider-neutral SDK contract
  and single public entrypoint.
---
# AI SDK maintenance

Keep provider-specific dependencies and request behavior inside an `AiProvider`
adapter. Expose the adapter factory and shared types only through `src/index.ts`.
Support cancellation, bounded timeouts, typed results, and safe error categories.
Do not log prompts or responses. Add a provider test double instead of making real
model calls in automated tests.
