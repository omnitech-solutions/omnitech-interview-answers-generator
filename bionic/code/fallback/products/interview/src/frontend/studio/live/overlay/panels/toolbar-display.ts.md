# products/interview/src/frontend/studio/live/overlay/panels/toolbar-display.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/toolbar-display.ts` (header-comment fallback)_

The capture menu's Display section: the displays the host lists while the
menu is open, and the choice a row makes. The rows are display-picker-model.ts;
this is the loop that feeds them.

[SAFETY] Thumbnails show what is on the owner's displays. They are fetched only
while the menu is open, held in this hook's state, dropped when it closes and
never stored, logged or sent anywhere. (The Display rows draw names and
positions only.)
