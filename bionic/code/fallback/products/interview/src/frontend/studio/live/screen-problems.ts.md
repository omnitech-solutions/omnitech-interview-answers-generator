# products/interview/src/frontend/studio/live/screen-problems.ts

_Source: `products/interview/src/frontend/studio/live/screen-problems.ts` (header-comment fallback)_

The screen problems the toolbar keeps on show until they are resolved
(permission missing, the chosen display gone, the last capture failed), each
with its fix action. The transient capture banner (use-capture-problem.ts)
still says what just happened; this is the state that stays. A small
external store like host-display.ts: in memory, nothing stored or sent.

[SAFETY] Closed kinds and constant text only: never a window title, an
address or captured content.
