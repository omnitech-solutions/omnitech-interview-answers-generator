# products/interview/src/frontend/studio/live/shared/screenshot-send.ts

_Source: `products/interview/src/frontend/studio/live/shared/screenshot-send.ts` (header-comment fallback)_

D35 / OBJ-8: the per-session setting "Screenshots to the model", as ONE
config-driven table plus the small pure rules around it, for the setup page,
the native Settings window, the web live page and the wording of the
screenshots tray and labels. No React and no network here.

The server is the authority: it reads the stored setting at each model call
and records what actually left the device. Wording here never claims more
than a server record says; a prediction is worded as one ("Will be...").
