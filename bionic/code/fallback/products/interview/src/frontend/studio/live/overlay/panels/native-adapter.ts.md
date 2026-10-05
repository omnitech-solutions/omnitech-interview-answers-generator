# products/interview/src/frontend/studio/live/overlay/panels/native-adapter.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/native-adapter.ts` (header-comment fallback)_

The native shell's presentation: `window.studioHost.presentation`, negotiated
by the contract and wrapped so a failing bridge call is a refusal (false),
never an exception in a window.
