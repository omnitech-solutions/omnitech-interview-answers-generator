# products/interview/src/frontend/studio/live/overlay/use-hands-free.ts

_Source: `products/interview/src/frontend/studio/live/overlay/use-hands-free.ts` (header-comment fallback)_

The hands-free controller: everything the overlay card and the Studio live
view's hands-free band share, written once. It owns the screen share, the
owner's capture prefs, hands-free Auto (listening and watching), the capture
and follow-up actions and the lines they leave. It renders nothing.

[SAFETY] Exactly ONE document owns the microphone, the screen and Auto, across
the Studio view, the card, the Picture-in-Picture window and the panels: a Web
Lock (panels/panel-owner.ts) that every one of them asks for. A document that
does not own mirrors the owner's state over the panel bus and asks it to act
there; it never listens or watches itself. A document runs ONE controller:
the Studio shell provides it (hands-free-context.tsx) and the card inside the
page reuses it.
