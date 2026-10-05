# products/interview/src/frontend/studio/live/overlay/auto-owner-pause.ts

_Source: `products/interview/src/frontend/studio/live/overlay/auto-owner-pause.ts` (header-comment fallback)_

A pause the OWNER pressed, remembered per session in this browser so every
window of Studio (the tab's card, the overlay window, the PiP) agrees: Auto
resumes a session that stopped for any other reason, never one the owner
deliberately paused. localStorage is optional and every access is guarded.
