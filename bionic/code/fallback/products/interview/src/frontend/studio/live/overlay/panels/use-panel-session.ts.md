# products/interview/src/frontend/studio/live/overlay/panels/use-panel-session.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/use-panel-session.ts` (header-comment fallback)_

The one session implementation behind every native window (and the same stores
the card uses): the session store (the server is the authority), the owner's
capture prefs, and, in the ONE document that owns the microphone and the
screen, hands-free Auto, dictation and captures. Other windows display that
owner's state and ask it to act through the panel bus.

[SAFETY] Nothing here hides a window or types into another app. A capture
goes through the same owner capture route, with the owner's region, as the
card's; a device-only session never sends one.
