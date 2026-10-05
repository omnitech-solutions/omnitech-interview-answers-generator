# products/interview/src/frontend/studio/live/float-host.tsx

_Source: `products/interview/src/frontend/studio/live/float-host.tsx` (header-comment fallback)_

The floating window: a Document Picture-in-Picture window that loads the
chromeless overlay route (overlay/overlay-page.tsx) in an iframe filling it.
The route is its own page: its own session store, polling and auth (same
origin, same cookies), so it keeps running while this page is in the
background and Chrome throttles it. Without the API (or when the browser
refuses) the presentation falls back to the card in the tab.

[SAFETY] The float closes the moment the session or the right to see it is
gone (floatAccessLost here, and the overlay page's own access rules, which
it reports to this host by message), when this page unloads (pagehide), when
the person closes the window, and when this host unmounts. Closing it only
changes layout: nothing here pauses, ends or purges.
