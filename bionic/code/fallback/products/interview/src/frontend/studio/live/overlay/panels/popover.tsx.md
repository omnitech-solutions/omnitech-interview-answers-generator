# products/interview/src/frontend/studio/live/overlay/panels/popover.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/popover.tsx` (header-comment fallback)_

A button with a floating panel under it: the capture menu, the answer-style
menu and the shortcut list are all this one primitive. It is controlled (the
toolbar keeps one open at a time), closes on Escape or a press outside, moves
focus into the panel when it opens and gives it back to the button when it
closes. A menu panel is also navigable with the arrow keys.
