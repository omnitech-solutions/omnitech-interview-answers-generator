# products/interview/src/frontend/studio/live/overlay/panels/presentation-host.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/presentation-host.ts` (header-comment fallback)_

The windows' one view of the presentation: a host-independent consumer of
the `PresentationHost` contract. A native shell supplies one
(native-adapter), and a plain tab, an installed app or a PiP window a no-op.
Views read `capabilities`, never which host this is.
