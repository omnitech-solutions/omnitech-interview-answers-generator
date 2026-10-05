# products/interview/src/frontend/studio/live/overlay/panels/toolbar.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/toolbar.tsx` (header-comment fallback)_

The toolbar, drawn from the tables in toolbar-config.ts: the capture control
(capture button with its screen-target chevron, and the mode menu), the
microphone, the answer style, the model chip, the pane toggles, See-through and
the shortcut list. It holds no session logic: every control calls the one
panel session.

[SAFETY] Nothing here conceals capture; See-through only lets the mouse reach
the page underneath over empty glass, and the window stays visible.
