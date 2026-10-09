# products/interview/src/frontend/studio/live/overlay/record-transcript.tsx

_Source: `products/interview/src/frontend/studio/live/overlay/record-transcript.tsx` (header-comment fallback)_

Record transcript: the owner's own keep of what this session hears, as a
file on this machine (transcript-recording.ts on the server).

[DOMAIN] It is a control of its own, not an item in a menu, because it must
be plain at a glance whether it is on: off is a quiet outline button, on is
a filled red one that says "Recording" and counts its lines.
[SAFETY] It is off every time the window opens. It turns off when the
session ends (the server does that) and when this window closes (below),
and it never comes back on by itself.
