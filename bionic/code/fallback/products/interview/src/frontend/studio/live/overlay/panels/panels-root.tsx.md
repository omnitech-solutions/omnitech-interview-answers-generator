# products/interview/src/frontend/studio/live/overlay/panels/panels-root.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/panels-root.tsx` (header-comment fallback)_

The overlay route with `?panel=single|settings`, the two pages the native
shell loads: the one compact window (toolbar, chat, answer and code) and the
small Settings window beside it. The card is the default of the route and is
untouched.

[SAFETY] Signed out or unavailable: a message, no panel; the store stops.
