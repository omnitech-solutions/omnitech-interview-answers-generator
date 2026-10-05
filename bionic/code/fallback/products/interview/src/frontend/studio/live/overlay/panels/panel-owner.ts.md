# products/interview/src/frontend/studio/live/overlay/panels/panel-owner.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/panel-owner.ts` (header-comment fallback)_

Exactly ONE panel document owns the microphone and the screen sampling at a
time (hands-free Auto, dictation, captures); the others display its state.
Ownership is a Web Lock held for the life of the document, so it passes on by
itself when the owner closes. The one compact window asks at once; the other
documents wait a moment so it wins when it is open. Without Web Locks (an old
browser, a test) a document owns what it shows.
