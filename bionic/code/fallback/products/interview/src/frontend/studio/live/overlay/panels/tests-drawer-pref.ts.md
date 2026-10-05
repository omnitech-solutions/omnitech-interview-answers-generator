# products/interview/src/frontend/studio/live/overlay/panels/tests-drawer-pref.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/tests-drawer-pref.ts` (header-comment fallback)_

Whether the code pane's Tests drawer is open: a per-viewer choice kept in this
browser, shared by every panel window through the `storage` event, exactly as
the glass preference is. Closed unless the person opened it. localStorage is
optional: every access is guarded, and the choice is then kept in memory.
