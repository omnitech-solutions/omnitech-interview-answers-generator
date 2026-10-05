# products/interview/src/frontend/studio/live/overlay/host-surface.ts

_Source: `products/interview/src/frontend/studio/live/overlay/host-surface.ts` (header-comment fallback)_

How the page paints inside a native shell window. The shell's window is
transparent (the desktop shows through), so the page marks its document
`data-panel-host="native"` and the CSS then uses translucent surfaces. A
browser tab, an installed web app and a PiP window are untouched: no attribute.
