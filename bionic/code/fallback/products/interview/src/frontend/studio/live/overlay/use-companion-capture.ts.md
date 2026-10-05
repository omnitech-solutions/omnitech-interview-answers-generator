# products/interview/src/frontend/studio/live/overlay/use-companion-capture.ts

_Source: `products/interview/src/frontend/studio/live/overlay/use-companion-capture.ts` (header-comment fallback)_

Asking the native companion to capture once, and following the request until it
is no longer pending: about once a second. Following stops when the request
ends, when a newer one replaces it, when the card goes away or the session
changes, and when the request's own deadline has passed.
