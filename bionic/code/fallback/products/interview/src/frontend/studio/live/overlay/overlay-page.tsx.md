# products/interview/src/frontend/studio/live/overlay/overlay-page.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/overlay-page.tsx` (header-comment fallback)_

The overlay route: /t/<tenant>/p/<product>/live/overlay. Only the native
shell loads it: `?panel=single` is its one compact window, `?panel=settings`
the small Settings window beside it, and a load that names neither is the
compact window. (An ordinary browser tab on this route is sent to the Studio
live page by overlay-guard.ts before this page is drawn.) The page is its
own: its own session store and polling (same-origin cookies), so it does not
depend on the Studio live page being mounted or visible.
