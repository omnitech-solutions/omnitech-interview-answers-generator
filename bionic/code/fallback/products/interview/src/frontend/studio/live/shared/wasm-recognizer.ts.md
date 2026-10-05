# products/interview/src/frontend/studio/live/shared/wasm-recognizer.ts

_Source: `products/interview/src/frontend/studio/live/shared/wasm-recognizer.ts` (header-comment fallback)_

The browser adapter: Tesseract.js running as WebAssembly in a worker, every
asset served from our own origin under /ocr (apps/web/scripts/copy-ocr-assets.mjs
copies the worker, the core and the English data there at build; no CDN, no
remote fetch). Behind the TextRecognizer port, so removing it means deleting
this file and the one line that passes it to chooseRecognizer.

One shared worker, loaded when the first image needs it, jobs one at a time,
each with its own budget; the worker is terminated once nothing has asked for
it for a while. If the assets or WebAssembly are missing it says
"unavailable" (and stays that way), never nothing.
