# apps/capture-companion/src/source-loss.ts

_Source: `apps/capture-companion/src/source-loss.ts` (header-comment fallback)_

A source that stops without the user asking: the OS revoked a permission or
a device vanished. The companion stops that source, tells Studio why
(source.disconnected plus a capture.gap), and shows it. It never returns to
"listening" for that source by itself.
