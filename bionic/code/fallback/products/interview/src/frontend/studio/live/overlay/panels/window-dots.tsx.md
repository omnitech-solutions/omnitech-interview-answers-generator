# products/interview/src/frontend/studio/live/overlay/panels/window-dots.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/window-dots.tsx` (header-comment fallback)_

The window's own controls, drawn from WINDOW_CONTROLS: red quits (after a
confirmation), yellow hides the window (pausing a live session first so
nothing keeps capturing out of sight), green toggles full screen and, when
the pointer rests on it, opens the window-size menu (WINDOW_MODES).

[SAFETY] Hiding never leaves capture or listening running: a session that is
live is paused before the window goes, and says so.
