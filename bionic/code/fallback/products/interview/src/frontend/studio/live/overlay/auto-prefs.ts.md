# products/interview/src/frontend/studio/live/overlay/auto-prefs.ts

_Source: `products/interview/src/frontend/studio/live/overlay/auto-prefs.ts` (header-comment fallback)_

Whether the owner wants Auto (hands-free), remembered per tenant in this
browser. Auto is ON by default where the host is hands-free (the native
shell) and once the owner has turned it on anywhere; it is off only where
the owner turned it off, and in a plain tab that nobody opted in.
localStorage is optional and every access is guarded.
