# apps/web/app/api/native-auth/complete/route.ts

_Source: `apps/web/app/api/native-auth/complete/route.ts` (header-comment fallback)_

The page the person's browser shows when sign-in is done: it hands control back
to the Mac app. The button is the exact callback address, and the page also
goes there by itself (a meta refresh: no script), so the browser asks "Open
Interview Studio?" once and the app takes over.

[SAFETY] The callback address holds a one-time code and nothing else; the page
loads nothing from anywhere, runs no script, and is never cached or framed.
