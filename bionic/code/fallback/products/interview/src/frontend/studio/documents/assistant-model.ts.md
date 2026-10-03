# products/interview/src/frontend/studio/documents/assistant-model.ts

_Source: `products/interview/src/frontend/studio/documents/assistant-model.ts` (header-comment fallback)_

The assistant's model picker owns the app's model choice, and the vendored
assistant package keeps it only in this per-viewer preference (it exports no
live state). This is the one place that knows the key; everything else asks
for a document target.
