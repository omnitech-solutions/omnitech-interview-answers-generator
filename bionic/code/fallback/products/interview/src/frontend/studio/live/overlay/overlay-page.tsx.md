# products/interview/src/frontend/studio/live/overlay/overlay-page.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/overlay-page.tsx` (header-comment fallback)_

The chromeless overlay route: /t/<tenant>/p/<product>/live/overlay.
It renders only the card, filling its viewport, and is a page of its own:
its own session store and polling (same-origin cookies), the switcher and
every action. It does not depend on the Studio live page being mounted or
visible, so any host can load it: the PiP window (in an iframe), the
installed web app, or a normal browser window. `?session=<id>` opens that
session; `?host=pip` adds "Back to Studio" (a message to the embedding
window). The native shell loads the same route with `?panel=single` (its one
compact window) or `?panel=settings`.

[SAFETY] On a 401 it shows a sign-in message, on a 404/403 a "session
unavailable" one, and in both the card is unmounted and the store stops
polling (the store halts on a terminal answer). Nothing is retained.
