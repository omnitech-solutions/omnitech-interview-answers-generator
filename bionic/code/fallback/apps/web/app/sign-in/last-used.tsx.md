# apps/web/app/sign-in/last-used.tsx

_Source: `apps/web/app/sign-in/last-used.tsx` (header-comment fallback)_

"Last used", from the one value the app stores after a successful sign-in.
It reads on mount, so the server-rendered page and the first client render
agree; storage can be unavailable, and then there is simply no chip.
