# products/interview/src/frontend/studio/live/shared/ocr-metrics.test.ts

_Source: `products/interview/src/frontend/studio/live/shared/ocr-metrics.test.ts` (header-comment fallback)_

D35: the page forwards the native text-box metrics, unchanged and validated,
into every `ocr` entry it uploads (staged Apply, Auto and hands-free frames).
Out of range or malformed means NO metrics (the server then sends the image).
