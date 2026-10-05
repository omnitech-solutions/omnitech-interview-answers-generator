# products/interview/src/backend/live-session/image-gate.ts

_Source: `products/interview/src/backend/live-session/image-gate.ts` (header-comment fallback)_

The image gate (decision D35): whether a screenshot's IMAGE reaches a model
beside, or instead of, its machine-read on-screen text. A pure decision from
the owner's per-session setting, the text block the device sent (with the
metrics the native recogniser measured) and the processing kind. It reads
text only to classify its shape; it stores, logs and returns none of it.

The rule that governs everything here: ANY DOUBT SENDS THE IMAGE. A missing
block or metric, a non-native engine, a long (possibly cut) text, a frame
that looks like code, a large untouched region, low confidence: each keeps
the image. Only a clean, fully read, prose-like frame may go as text alone.
