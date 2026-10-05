# products/interview/src/frontend/studio/live/shared/image-viewer.test.tsx

_Source: `products/interview/src/frontend/studio/live/shared/image-viewer.test.tsx` (header-comment fallback)_

The viewer draws the image at the size the model says (F5): zooming enlarges
the drawn image past the stage, Fit leaves it to the stylesheet, 100% is one
image pixel per CSS pixel. jsdom has no layout, so the drawn size is the
inline style the component sets; the stylesheet guard below keeps a zoomed
image from being shrunk back by the stage's flex layout.
