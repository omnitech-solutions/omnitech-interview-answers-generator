# products/interview/src/frontend/studio/live/overlay/panels/mic-menu-model.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/mic-menu-model.ts` (header-comment fallback)_

The microphone caret menu as data: the devices, the one in use, and the
status the control shows (listening, muted, lost, retrying with its attempt)
with the "Retry now" action. Derived from the engine's own typed state
(use-engine.ts); the Alt+R toggle is unchanged. Pure: no React, no bridge.
