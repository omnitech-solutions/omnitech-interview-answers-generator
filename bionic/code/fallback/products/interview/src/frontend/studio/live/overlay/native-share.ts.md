# products/interview/src/frontend/studio/live/overlay/native-share.ts

_Source: `products/interview/src/frontend/studio/live/overlay/native-share.ts` (header-comment fallback)_

"This Mac (native)": the host adapter's screen as a share source (ADR-0019).
It has the shape of the browser's ShareHandle so the strip, the mask chip and
Analyze work unchanged; it differs in having no live stream (the host captures
one fresh image per press) and in taking its own frames. Nothing is kept.
