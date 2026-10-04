# products/interview/src/frontend/studio/live/focus-view.tsx

_Source: `products/interview/src/frontend/studio/live/focus-view.tsx` (header-comment fallback)_

The Focus presentation: the same session, compact. It is composed from the
existing result components (TaskPanel, TaskSelector, IdleState) and reads
only the one store; it fetches, converses and edits nothing of its own. The
float renders this same component in its own window. Nothing here moves
keyboard focus when a result arrives.
