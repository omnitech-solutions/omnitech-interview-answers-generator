# products/interview/src/backend/live-session/screenshot-text.ts

_Source: `products/interview/src/backend/live-session/screenshot-text.ts` (header-comment fallback)_

Text read from a screenshot on the owner's device (OCR). It is session content
like the screenshot itself: stored on the screenshot's observation, never
logged, never returned to the browser, and sent to a model only beside the
image (device-only sessions send neither). Two pure helpers live here: the
normalisation applied before storing, and the mechanical "looks cut off" hint.
