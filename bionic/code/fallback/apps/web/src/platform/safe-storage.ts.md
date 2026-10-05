# apps/web/src/platform/safe-storage.ts

_Source: `apps/web/src/platform/safe-storage.ts` (header-comment fallback)_

Browser storage that never throws: private windows and blocked site data make
`localStorage` throw on access, so a read or write falls back to memory for
this page visit instead of breaking the screen.
