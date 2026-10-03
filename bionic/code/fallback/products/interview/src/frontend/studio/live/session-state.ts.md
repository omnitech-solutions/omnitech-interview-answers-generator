# products/interview/src/frontend/studio/live/session-state.ts

_Source: `products/interview/src/frontend/studio/live/session-state.ts` (header-comment fallback)_

The view model every Live session screen reads: a PURE derivation from the
session record, the observations and actions the store holds, and a point in
time. No fetching, no timers, no React: the same inputs give the same model,
which is what the derivation tests rely on.
