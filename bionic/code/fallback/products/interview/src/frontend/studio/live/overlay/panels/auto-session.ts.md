# products/interview/src/frontend/studio/live/overlay/panels/auto-session.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/auto-session.ts` (header-comment fallback)_

A natively hosted window never starts a session behind the person's back. It
shows the idle "No live session" screen and a Start button (start-panel.tsx);
a session that is already running (started on the web, or by another native
window) is adopted, never duplicated. This file keeps the two pieces that stay:
- the shell's one-time consent, read and re-read while it is missing, so a
window can say "Consent required" and offer the shell's own dialog;
- the panel bus: the window that starts a session announces it and the other
windows (Settings) open that session.

[SAFETY] Starting is not capturing: the screen is captured on the capture
command only, and the shell's consent comes first.
