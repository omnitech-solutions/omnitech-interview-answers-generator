# products/interview/src/frontend/studio/live/overlay/overlay-card.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/overlay-card.tsx` (header-comment fallback)_

The overlay card: the Active Session as a compact card, composed from the one
session store (useLiveSession), the one hands-free controller
(use-hands-free.ts) and the pure overlay model. It fetches, converses and
edits nothing of its own. Three hosts show this same component: the Studio
page (a draggable card floating over it), the Document Picture-in-Picture
window (the card fills it) and the chromeless overlay route (the card fills
the viewport). Inside the Studio page the card reuses the page's controller,
so the page and the card never run two microphones. Nothing here moves
keyboard focus when a result arrives.

[SAFETY] The footer says plainly that this is a normal window that shows in
screen shares. Nothing here types into another app or hides the card.
