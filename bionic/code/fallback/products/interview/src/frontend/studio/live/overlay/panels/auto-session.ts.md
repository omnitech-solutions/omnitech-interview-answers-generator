# products/interview/src/frontend/studio/live/overlay/panels/auto-session.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/auto-session.ts` (header-comment fallback)_

A natively hosted window never asks the person to "start a session in Studio":
once the shell has recorded its one-time consent, the first window document to
find no live session starts one with the defaults (permitted-remote, the
microphone, the app's audio and the screen). A Web Lock lets exactly one
document start it; it tells the others over the panel bus, which then open
that session. Without the shell's consent nothing starts: the window shows one
"Consent required" line with a button that asks the shell for its dialog.

[SAFETY] Starting a session is not capturing: the screen is captured on the
capture command only, and the shell's consent comes first.
