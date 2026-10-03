# products/interview/src/frontend/studio/live/companion-capability.ts

_Source: `products/interview/src/frontend/studio/live/companion-capability.ts` (header-comment fallback)_

What the companion last told Studio about itself, as plain data for the
screens: the speech state, the device-only blockers and the permission lines.
Pure, no React and no fetching.

The report is the owner's LAST one (GET .../sessions/companion-capability),
sent by the companion when it checks itself at the start of a session
(ADR-0012, Locality by stage). It is not a live connection: nothing here says
the companion is running or connected. With no report, nothing is assumed.

Facts these strings rest on (each is a test in guarantee-strings.test.tsx):
- the companion always requires on-device recognition, whatever the
session's policy, so allowing remote processing does not make an
unsupported language work (ADR-0012 "Locality by stage"; plan D5);
- a failing check stops the audio sources visibly in the companion, and
Studio never falls back to a remote speech service by itself.
