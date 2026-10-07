# products/interview/src/frontend/studio/live/overlay/panels/portal-root.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/portal-root.ts` (header-comment fallback)_

Where a portalled library surface (menu, popover, tooltip, dialog) is drawn:
inside the panel root, so it shares the window's glass, theme and see-through
tokens and stays inside the page the native shell hit-tests. The surfaces
carry `data-oui-surface`, which the hit regions already list.
