# products/interview/src/frontend/studio/live/host-adapter.ts

_Source: `products/interview/src/frontend/studio/live/host-adapter.ts` (header-comment fallback)_

The Studio side of the host adapter contract (ADR-0019). A native shell that
hosts the overlay route injects `window.studioHost`; this file reads it, and
is the only place the frontend does. Without it (a browser, an installed web
app) every function here reports "no host" and the page behaves as before.
