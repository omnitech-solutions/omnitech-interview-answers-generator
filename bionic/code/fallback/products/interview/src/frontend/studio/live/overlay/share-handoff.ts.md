# products/interview/src/frontend/studio/live/overlay/share-handoff.ts

_Source: `products/interview/src/frontend/studio/live/overlay/share-handoff.ts` (header-comment fallback)_

"Start hands-free" asks for the screen in the click that starts the session,
because the browser only shows its picker from a user gesture and starting a
session takes a network round trip. The share it gets is parked here until
the session's card mounts and adopts it. A share nobody adopts is stopped.
