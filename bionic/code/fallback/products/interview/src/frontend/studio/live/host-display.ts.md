# products/interview/src/frontend/studio/live/host-display.ts

_Source: `products/interview/src/frontend/studio/live/host-display.ts` (header-comment fallback)_

Where the host last captured from, and whether the person pinned capture to a
display (D32, D33). The shell owns the pin; this is the page's copy of what
the shell last said, fed by four echoes only: a capture result, a screen
watch change, a `setCaptureDisplay` answer and a `listDisplays` answer (which
carries the pin, so a fresh page learns it on mount). Kept in memory;
nothing here is stored, logged or sent anywhere.
