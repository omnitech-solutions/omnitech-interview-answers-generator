# products/interview/src/frontend/studio/live/overlay/hands-free-band.test.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/hands-free-band.test.tsx` (header-comment fallback)_

The Studio live view is the hands-free view: the same bar, Auto line, capture
strip and follow-up box as the card, in a band under the session bar. This
document owns the microphone and Auto when it is the only one, mirrors when
another document owns them, adopts the share "Start hands-free" parked, and
never runs a second Auto when the card is opened inside the page.
