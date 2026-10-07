# products/interview/src/frontend/studio/live/overlay/panels/hit-regions.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/hit-regions.ts` (header-comment fallback)_

Pass-through, page side. In the native compact window the page tells the shell
the rectangle of every surface it paints or lets the person use, and the window
takes the mouse only there; whatever is not drawn (empty glass around the
toolbar, the gap above the footer, clear glass) passes clicks to whatever is
underneath (Chrome), and is never a place to drag the window from. The selector table below is the ONE list of such surfaces.

[SAFETY] The toolbar is always in the table, so See-through can always be turned
off with the mouse. `null` (see-through off, unmounted, page hidden) makes the
whole window interactive, and while it is on the report is repeated so the shell
can tell a silent page from a still one (it falls back to interactive).
