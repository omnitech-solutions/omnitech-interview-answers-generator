# products/interview/src/frontend/studio/live/overlay/studio-links.ts

_Source: `products/interview/src/frontend/studio/live/overlay/studio-links.ts` (header-comment fallback)_

Where the card sends the person in Studio. Inside Studio's own page the card
moves the Studio route directly. On the overlay page (the PiP window or a
standalone window) it sends a navigation intent to the Studio tab, which
opens a new tab if nothing is listening.
