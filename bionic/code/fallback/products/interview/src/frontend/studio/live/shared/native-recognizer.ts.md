# products/interview/src/frontend/studio/live/shared/native-recognizer.ts

_Source: `products/interview/src/frontend/studio/live/shared/native-recognizer.ts` (header-comment fallback)_

The native adapter: the shell reads the image with Apple Vision (bridge op
`recognizeText`). The page reads the FINAL bytes, so a crop it encoded itself
is recognised as cropped. Only the image's type and bytes cross the bridge.
