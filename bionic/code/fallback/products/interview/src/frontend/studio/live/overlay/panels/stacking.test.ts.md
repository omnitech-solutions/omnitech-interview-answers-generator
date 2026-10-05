# products/interview/src/frontend/studio/live/overlay/panels/stacking.test.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/stacking.test.ts` (header-comment fallback)_

Popovers hang from the toolbar, so they paint in the toolbar's stacking
context. The status strip and the panes use backdrop-filter, which gives each
its own stacking context; with the toolbar left at z-index auto, those later
siblings painted OVER an open menu. One named scale fixes the order for every
popover; the clear (glass) mode must not touch it.
