# products/interview/src/frontend/studio/live/session-registry.ts

_Source: `products/interview/src/frontend/studio/live/session-registry.ts` (header-comment fallback)_

One session store per tenant slug, for the life of the page. A module-level
registry (not React state) is what lets the session outlive every view.
