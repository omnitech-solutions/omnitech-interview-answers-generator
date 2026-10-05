# apps/web/src/platform/web-app-manifest.ts

_Source: `apps/web/src/platform/web-app-manifest.ts` (header-comment fallback)_

The Web App Manifest that lets a browser offer "Install app" for Interview
Studio's live overlay (ADR-0019). The installed window loads the same overlay
route every other host loads (ADR-0017); the manifest only names it. Chrome
needs no service worker to install (a manifest with icons, a start_url and a
standalone display is enough), so none is shipped: the page is online-only
and nothing is cached.

[SAFETY] The manifest carries a tenant slug and static text, no session,
credential or content, so it is served without a sign-in (a browser fetches it
without cookies).
