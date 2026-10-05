# products/interview/src/frontend/studio/live/overlay/capture-source.ts

_Source: `products/interview/src/frontend/studio/live/overlay/capture-source.ts` (header-comment fallback)_

The browser's own screen capture for Analyze. The person picks a window, tab
or screen once, in the browser's picker, from a click in this document; the
stream then stays open and the preview stays on this device. A frame is taken
only when Analyze is pressed: it is cropped to the person's region, scaled
down and encoded here, so pixels outside the region never leave the device.

[SAFETY] The label sent with a frame says only what KIND of source it is
("Window", "Tab", "Screen") and whether a region was applied. It is never the
title of a window or tab.
