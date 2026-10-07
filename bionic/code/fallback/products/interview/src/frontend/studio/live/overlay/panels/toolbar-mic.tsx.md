# products/interview/src/frontend/studio/live/overlay/panels/toolbar-mic.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/panels/toolbar-mic.tsx` (header-comment fallback)_

The microphone control, with Zoom's semantics: listening is neutral, muted is
red and slashed, lost or retrying is an amber outline with a "!" badge. The
caret lists the devices (when the shell sends them), says "Microphone lost ·
Trying again · attempt n" and offers "Retry now". The Alt+R toggle is the same
press as ever (s.press("toggle-mic")); the device list and the attempt count
are optional: a shell that sends neither gets the plain menu and a Retry now
that restarts the engine.
