# products/interview/src/frontend/studio/live/overlay/auto-restart.ts

_Source: `products/interview/src/frontend/studio/live/overlay/auto-restart.ts` (header-comment fallback)_

Keeps continuous listening alive without a restart storm. The browser ends a
recognition session after silence or an error; a run that lived a while or
heard something restarts at once, and one that dies young waits longer each
time (doubling, capped) until a run is healthy again. Pure: a clock in, a
delay out.
