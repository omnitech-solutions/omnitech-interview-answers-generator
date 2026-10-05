# products/interview/src/frontend/studio/live/overlay/auto-interval.ts

_Source: `products/interview/src/frontend/studio/live/overlay/auto-interval.ts` (header-comment fallback)_

Auto's screen watch is an interval (ADR-0022, revised): every few seconds a
frame is sampled on this device and hashed. A frame is uploaded and analysed
only when it differs from the last ANALYSED frame, is the first, or (an
option, off by default) a heartbeat has elapsed. Identical frames are dropped
here and never leave the device. Pure; the hook runs the timer.
