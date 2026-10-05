# products/interview/src/frontend/studio/live/shared/screenshot-tray.ts

_Source: `products/interview/src/frontend/studio/live/shared/screenshot-tray.ts` (header-comment fallback)_

The staging tray's state machine (D29, D30): screenshots staged ON THE DEVICE
until Apply, then ONE atomic request. Pure: no clock, no network, no React.
The hook (use-screenshot-tray.ts) feeds it events; both surfaces draw the
same state. Nothing here ever holds image text or logs anything.
