# products/interview/src/frontend/studio/live/overlay/menu-placement.ts

_Source: `products/interview/src/frontend/studio/live/overlay/menu-placement.ts` (header-comment fallback)_

Keeps a menu fully visible inside the card (which clips what overflows it):
below its anchor when it fits, otherwise above when there is more room, with a
maximum height so it scrolls inside, and shifted sideways to stay within the
card. Pure placement, plus a layout effect that applies it.
