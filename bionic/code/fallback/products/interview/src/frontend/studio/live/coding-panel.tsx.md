# products/interview/src/frontend/studio/live/coding-panel.tsx

_Source: `products/interview/src/frontend/studio/live/coding-panel.tsx` (header-comment fallback)_

A programming challenge: its constraints across revisions and two tabs, the
answer (the model's restatement and suggested answer) and the code. Generated,
tests passed and fully verified are three separate facts and are never
merged: the stage tiles and badges come from the one task card model, and
"verified" is shown only when the server says fullyVerified
(rule:fenced-current-publish and code-states.ts). The code is an editable,
runnable canvas (overlay/code-canvas.tsx); the Workspace draft remains the
saved copy.
