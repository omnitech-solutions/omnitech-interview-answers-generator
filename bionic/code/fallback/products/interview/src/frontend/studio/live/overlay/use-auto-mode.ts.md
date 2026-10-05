# products/interview/src/frontend/studio/live/overlay/use-auto-mode.ts

_Source: `products/interview/src/frontend/studio/live/overlay/use-auto-mode.ts` (header-comment fallback)_

Hands-free Auto (ADR-0022): continuous listening whose finished phrases go to
the session as heard speech, and a watch on the shared screen that captures
and analyses when the picture changes and settles. Owner-enabled, visible,
one click to stop. Nothing here sends a frame: a capture goes through the
card's own capture route, with the owner's region, exactly as a press would.

[SAFETY] The decisions live in pure modules (auto-interval, auto-gate,
auto-restart, auto-line); this hook only runs the timers and calls out.
