# products/interview/src/frontend/studio/live/overlay/capture-trigger.ts

_Source: `products/interview/src/frontend/studio/live/overlay/capture-trigger.ts` (header-comment fallback)_

One physical "capture & analyze" press is ONE logical capture. The same press
can reach the card by several routes at once: its own Alt+Shift+A keydown, the
native shell's system-wide hotkey (to every page it hosts: the Studio tab's
card and the overlay window) and a key repeat. Each route asks here first; a
trigger is granted once per window of time, in this page by a timestamp and
across same-origin windows by a Web Lock that nobody else can take meanwhile.
Without Web Locks, the page-level rule still holds.
