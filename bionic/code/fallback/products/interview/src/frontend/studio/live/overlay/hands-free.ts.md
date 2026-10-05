# products/interview/src/frontend/studio/live/overlay/hands-free.ts

_Source: `products/interview/src/frontend/studio/live/overlay/hands-free.ts` (header-comment fallback)_

"Start hands-free": the one setup (ADR-0022). In the click that starts the
session it asks for the screen share and the microphone together, because
the browser only shows the share picker from a user gesture and starting the
session takes a round trip. The share is parked for the session's card to
adopt; the microphone permission is the browser's, remembered for this site.
The browser cannot be told to share again later without a click, which is why
this is asked once, up front.
