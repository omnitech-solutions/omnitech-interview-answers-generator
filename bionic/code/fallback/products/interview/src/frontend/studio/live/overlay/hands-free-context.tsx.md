# products/interview/src/frontend/studio/live/overlay/hands-free-context.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/hands-free-context.tsx` (header-comment fallback)_

The one hands-free controller of a document, offered to everything in it: the
Studio shell mounts the provider once, so the live view's band and the card
opened inside the page are two views of the SAME microphone, share and Auto,
never two of them. A document without the provider (the overlay window, the
Picture-in-Picture frame, a test) gives each view its own controller, which
still takes part in the one-owner rule across documents.
