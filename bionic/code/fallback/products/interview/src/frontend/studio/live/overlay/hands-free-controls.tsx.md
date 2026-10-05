# products/interview/src/frontend/studio/live/overlay/hands-free-controls.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/hands-free-controls.tsx` (header-comment fallback)_

The hands-free controls, rendered from the one controller (use-hands-free.ts):
the command bar, the Auto line, the device-only notice, the capture strip and
the follow-up box. The overlay card places these pieces in its own layout; the
Studio live view shows them together as a band at the top of the page
(HandsFreeBand). Nothing is duplicated: both are views of the same state.
