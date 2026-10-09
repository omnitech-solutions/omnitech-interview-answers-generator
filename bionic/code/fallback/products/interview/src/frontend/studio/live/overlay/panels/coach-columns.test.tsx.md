# products/interview/src/frontend/studio/live/overlay/panels/coach-columns.test.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/coach-columns.test.tsx` (header-comment fallback)_

The sizes a coach layout keeps. The library's Splitter draws and resizes the
columns and the room for the call (coach-layout.test.tsx covers the bars);
this module is only where the sizes are remembered: the Splitters' own, by
panel id, and the window's width and height, with the reset that puts all
of it back, and how large the notes read. The module remembers the window's
width and height and the notes' size in variables, so each test reads it
fresh.
