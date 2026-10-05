# products/interview/src/frontend/studio/live/shared/text-recognizer.ts

_Source: `products/interview/src/frontend/studio/live/shared/text-recognizer.ts` (header-comment fallback)_

Page-side text recognition (D31): every screenshot is read on the device
before it is uploaded, so the model also gets exact text and numbers. ONE
port, two adapters behind it (native-recognizer.ts: Apple Vision through the
shell's bridge; wasm-recognizer.ts: Tesseract.js served from our own origin),
and an explicit "none" recognizer. A caller that gets no text still sends the
image. Text is machine-read: it is held in memory for one Apply, never logged
and never persisted here (AGENTS.md rule 8).
