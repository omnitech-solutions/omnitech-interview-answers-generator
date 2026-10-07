# products/interview/src/frontend/studio/live/overlay/hands-free-context.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/hands-free-context.tsx` (header-comment fallback)_

The one hands-free controller of a document, offered to everything in it: the
Studio shell mounts the provider once, so the live view's screenshots area
and the missing-context actions share the SAME share and Auto, never two of
them. A view without the provider says capture is not available. The
controller still takes part in the one-owner rule across documents.
