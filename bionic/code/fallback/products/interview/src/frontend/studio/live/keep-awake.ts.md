# products/interview/src/frontend/studio/live/keep-awake.ts

_Source: `products/interview/src/frontend/studio/live/keep-awake.ts` (header-comment fallback)_

A page that is listening or watching a shared screen must keep reading the
session while it is in a background tab: the store otherwise stops polling
whenever the page is hidden, so a hands-free window would only update when
the owner switched back to it. A hold is released by the function it returns;
holds count, so the mic and the share can each take one.
