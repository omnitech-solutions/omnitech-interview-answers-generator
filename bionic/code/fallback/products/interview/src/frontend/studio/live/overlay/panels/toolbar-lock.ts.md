# products/interview/src/frontend/studio/live/overlay/panels/toolbar-lock.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/toolbar-lock.ts` (header-comment fallback)_

Before a session runs the window shows the SAME toolbar, every session control
disabled and naming what is missing ("Sign in first", "Start a session first").
The reason travels by context so no control is reimplemented: each one reads it
and adds `disabled` and the reason as its title. Null (the live window) changes
nothing. The window's own controls (the red, yellow and green dots) are not
session controls and stay live.
