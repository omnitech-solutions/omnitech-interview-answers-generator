# products/interview/src/frontend/studio/live/overlay/panels/summary-link.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/summary-link.ts` (header-comment fallback)_

Opens a finished session's summary in Studio. The native window hands the
address to the person's browser through the shell's openExternal bridge; with
no bridge it uses the same navigation the card uses (the Studio tab, or a
new one).
