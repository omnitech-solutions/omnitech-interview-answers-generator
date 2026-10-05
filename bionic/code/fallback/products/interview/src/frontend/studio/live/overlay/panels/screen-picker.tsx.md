# products/interview/src/frontend/studio/live/overlay/panels/screen-picker.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/screen-picker.tsx` (header-comment fallback)_

The screen picker (D33), now the chevron of the capture control: a menu of
"Follow my browser" and one row per display with a live thumbnail, opened from
the chevron, the capture button's right-click or its ArrowDown key. The host
only offers it ("display-selection"), so the web has none.

[SAFETY] Thumbnails show what is on the owner's displays. They are fetched only
while the menu is open, held in this component's state, dropped when it closes
and never stored, logged or sent anywhere.
