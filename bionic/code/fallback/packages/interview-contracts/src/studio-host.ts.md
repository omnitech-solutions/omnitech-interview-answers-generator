# packages/interview-contracts/src/studio-host.ts

_Source: `packages/interview-contracts/src/studio-host.ts` (header-comment fallback)_

The host adapter contract (ADR-0019): what a native shell that hosts the one
overlay route (ADR-0017) offers the Studio frontend as `window.studioHost`.
A shell fulfils capture and window chrome; it owns no session state, makes no
assist request and calls no model. Every frame it returns is posted by the
page to the existing owner-authenticated capture route, so masking-before-send,
locality, stale protection and persistence stay Studio's (ADR-0018).

A browser and an installed web app have no bridge: `window.studioHost` is
absent and the page uses the browser's own capture, as before.
