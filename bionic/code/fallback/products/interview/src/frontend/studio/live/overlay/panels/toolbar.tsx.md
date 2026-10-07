# products/interview/src/frontend/studio/live/overlay/panels/toolbar.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/toolbar.tsx` (header-comment fallback)_

The toolbar, drawn from the library's Toolbar: the window's controls, the ONE
capture split button, the microphone split button, the answer style, the model
chip, the panel toggles (one segmented group), See-through and the shortcut
list. It holds no session logic: every control calls the one panel session.
The tables it is drawn from are toolbar-config.ts; what each control says is
toolbar-model.ts.

[SAFETY] Nothing here conceals capture; See-through only lets the mouse reach
the page underneath over empty glass, and the window stays visible.
