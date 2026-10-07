# products/interview/src/frontend/studio/live/overlay/panels/toolbar-capture.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/toolbar-capture.tsx` (header-comment fallback)_

The capture control: ONE split button. The main half captures (or stops the
run while one is analysing); the caret opens the capture menu: "When to
analyse" (Manual or Auto), "Display" (where the host can choose a screen) and
"Add screen to this task". Manual is neutral and Auto is tinted blue; there is
no mode pill and no coloured dot, and the tooltip names the mode. A screen
problem (permission missing, display gone, last capture failed) turns the
control amber with a "!" badge and leads the menu with the reason and its fix.

[SAFETY] Nothing here conceals capture; the control only asks the one panel
session to capture or stop.
