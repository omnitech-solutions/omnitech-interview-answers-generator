# products/interview/src/frontend/studio/live/float-host.tsx

_Source: `products/interview/src/frontend/studio/live/float-host.tsx` (header-comment fallback)_

The floating window: Focus in a Document Picture-in-Picture window, mounted
by a portal under the persistent Studio live view. Selection and pinning
live in focus-presentation, above the portal. Without the API (or when the
browser refuses) the presentation falls back to Focus in the tab.

[SAFETY] The float closes, and its content unmounts, the moment the session
or the right to see it is gone (floatAccessLost), when the page unloads
(pagehide), and when this host unmounts. Closing it only changes layout:
nothing here pauses, ends or purges.
