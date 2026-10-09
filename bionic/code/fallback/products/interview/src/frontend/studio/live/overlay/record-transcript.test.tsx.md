# products/interview/src/frontend/studio/live/overlay/record-transcript.test.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/record-transcript.test.tsx` (header-comment fallback)_

The Record transcript control against a server the test holds by hand: it
is off until pressed, says plainly when it is on and how many lines it
holds, reads the count again while on, and never leaves a recording
running behind a window that has closed. Opening the window reads the
server's state once (and stops a recording found on), so every case begins
with that one GET.
