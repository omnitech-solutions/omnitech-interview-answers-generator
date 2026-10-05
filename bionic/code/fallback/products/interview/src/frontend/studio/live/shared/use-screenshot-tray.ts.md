# products/interview/src/frontend/studio/live/shared/use-screenshot-tray.ts

_Source: `products/interview/src/frontend/studio/live/shared/use-screenshot-tray.ts` (header-comment fallback)_

The staging tray as a hook: the pure state machine (screenshot-tray.ts), the
on-device text of each staged image (use-staged-recognition.ts) and Apply as
ONE atomic `applyContext` call. Both surfaces call it once (the native panel
session, the web hands-free controller) and draw the same model. Images stay
in this hook's memory until Apply; nothing is uploaded before it.
