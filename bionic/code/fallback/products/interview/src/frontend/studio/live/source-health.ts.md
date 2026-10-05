# products/interview/src/frontend/studio/live/source-health.ts

_Source: `products/interview/src/frontend/studio/live/source-health.ts` (header-comment fallback)_

How a capture source's health is NAMED and TONED, once. The session bar's
chips, the Sources tab and the native source popover all read this table, so
one health never reads "Stopped" on one surface and "Disconnected" on
another. Pure; the health itself is derived in session-sources.ts.
