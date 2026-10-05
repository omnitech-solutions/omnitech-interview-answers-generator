# products/interview/src/frontend/studio/live/shared/use-staged-recognition.ts

_Source: `products/interview/src/frontend/studio/live/shared/use-staged-recognition.ts` (header-comment fallback)_

Reads each staged screenshot as it is staged (T17b's tray), and again when a
crop gives it new bytes. The cache is keyed by BLOB IDENTITY: a crop produces
a new Blob, so the old read is dropped and the final bytes are read; the
same Blob is never read twice. Removing an image (or leaving the page)
aborts its read. The text lives in this hook's memory for one Apply: it is
never logged and never persisted (AGENTS.md rule 8).
