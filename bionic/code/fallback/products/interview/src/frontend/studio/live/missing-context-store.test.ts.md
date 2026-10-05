# products/interview/src/frontend/studio/live/missing-context-store.test.ts

_Source: `products/interview/src/frontend/studio/live/missing-context-store.test.ts` (header-comment fallback)_

The missing-context journey at the store: one request per send, blank text
refused without a request, and two clients of the same session (the native
window and the web page are separate documents with a store each) agreeing
on the strip and on what clears it.
