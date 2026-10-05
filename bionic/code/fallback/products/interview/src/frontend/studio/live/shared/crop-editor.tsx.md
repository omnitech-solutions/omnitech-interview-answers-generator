# products/interview/src/frontend/studio/live/shared/crop-editor.tsx

_Source: `products/interview/src/frontend/studio/live/shared/crop-editor.tsx` (header-comment fallback)_

Crop one staged screenshot: drag a free (aspect-free) selection on the image,
resize it from eight handles, or type exact pixels. Handles are buttons, so
the arrow keys nudge them. The editor only reports the rectangle; the caller
makes the new Blob (screenshot-crop.ts) and the tray re-reads its text.
