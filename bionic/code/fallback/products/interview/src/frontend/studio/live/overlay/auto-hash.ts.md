# products/interview/src/frontend/studio/live/overlay/auto-hash.ts

_Source: `products/interview/src/frontend/studio/live/overlay/auto-hash.ts` (header-comment fallback)_

A cheap perceptual hash of a frame, computed on this device (ADR-0022). The
frame is drawn onto a 9x8 canvas, turned to grey, and each pixel is compared
with its right-hand neighbour (a "difference hash"): 64 bits that change when
the picture really changes and barely at all for noise. Nothing is stored or
sent; the hash only decides WHEN a capture is worth taking.
