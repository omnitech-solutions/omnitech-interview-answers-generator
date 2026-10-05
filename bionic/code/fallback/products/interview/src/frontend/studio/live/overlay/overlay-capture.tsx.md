# products/interview/src/frontend/studio/live/overlay/overlay-capture.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/overlay-capture.tsx` (header-comment fallback)_

The capture strip: the shared source (a live local preview, its kind and a
Region chip), Stop sharing, and "Capture & analyze". Analyze takes a FRESH
frame now, cropped to the region in this browser, and sends it; with no source
shared the button opens the source menu instead. The last analyzed capture is
kept as history below. Only the person pressing it sends a screenshot.
