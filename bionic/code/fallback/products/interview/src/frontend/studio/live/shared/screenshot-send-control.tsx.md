# products/interview/src/frontend/studio/live/shared/screenshot-send-control.tsx

_Source: `products/interview/src/frontend/studio/live/shared/screenshot-send-control.tsx` (header-comment fallback)_

The "Screenshots to the model" control (D35 / OBJ-8): ONE component for the
web setup page, the native Settings window and the web live page. A radio
group (the native radio is the control, so keyboard and screen-reader
behaviour is the browser's own: Tab reaches the checked option, the arrow
keys move and select) drawn from the config table in screenshot-send.ts.
It owns no state: the caller gives the value to show and takes the change.
