# products/interview/src/frontend/studio/live/overlay/panels/panel-glass.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/panel-glass.ts` (header-comment fallback)_

Whether the panel's glass is clear (see-through) or the default tinted glass:
a per-viewer choice kept in this browser, shared by every panel window of the
app through the `storage` event, as the Auto preference is. The one effect is
the `data-glass` attribute on the panel root; panels.css flips the glass tokens
from it. localStorage is optional: every access is guarded, and the choice is
then kept in memory for this window only.
