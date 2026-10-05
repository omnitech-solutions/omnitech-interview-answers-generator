# products/interview/src/frontend/studio/live/shared/image-viewer.tsx

_Source: `products/interview/src/frontend/studio/live/shared/image-viewer.tsx` (header-comment fallback)_

The screenshot viewer: a modal dialog (focus kept inside, Escape closes, focus
returns to the thumbnail) with zoom in/out, Fit, 100% and pan by drag or the
arrow keys. A staged image can also be cropped from here. Stored images load
only from the existing authenticated route (`src`); staged ones from their
own Blob URL. It draws no text from the screenshot, only the state of it.
