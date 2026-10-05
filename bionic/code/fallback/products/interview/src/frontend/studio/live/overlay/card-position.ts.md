# products/interview/src/frontend/studio/live/overlay/card-position.ts

_Source: `products/interview/src/frontend/studio/live/overlay/card-position.ts` (header-comment fallback)_

Where the overlay card sits when it floats over the Studio page. Pure
clamping, plus a position kept for the session in memory (and
sessionStorage, where the browser allows it). The PiP window and the
chromeless route do not use this: their window is the drag surface.
