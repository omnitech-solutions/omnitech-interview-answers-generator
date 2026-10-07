# products/interview/src/frontend/studio/live/overlay/use-hands-free.ts

_Source: `products/interview/src/frontend/studio/live/overlay/use-hands-free.ts` (header-comment fallback)_

The hands-free controller: what the Studio web page's screenshots area and
missing-context actions use, written once. It owns the screen share, the
owner's capture prefs, hands-free Auto (listening and watching), the capture
and follow-up actions and the lines they leave. It renders nothing.

[SAFETY] Exactly ONE document owns the microphone, the screen and Auto, across
the Studio view and the native panels: a Web Lock (panels/panel-owner.ts)
that every one of them asks for. A document that does not own mirrors the owner's state over the panel bus and asks it to act
there; it never listens or watches itself. A document runs ONE controller:
the Studio shell provides it (hands-free-context.tsx).
