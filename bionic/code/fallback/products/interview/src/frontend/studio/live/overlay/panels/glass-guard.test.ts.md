# products/interview/src/frontend/studio/live/overlay/panels/glass-guard.test.ts

_Source: `products/interview/src/frontend/studio/live/overlay/panels/glass-guard.test.ts` (header-comment fallback)_

The glass guard: a surface under the panel root may never paint its own dense
literal background or its own blur, because the clear (Transparent background)
look is driven by tokens (--pn-glass*, --pn-blur-*, --pn-bed) and a literal
would defeat it. Measured in WebKit over a checkerboard (e2e glass-clear.spec.ts):
the panes, strip, toolbar and footer must keep the backdrop visible.

Fails on: a literal background (rgba alpha > .30, #hex, rgb()) or a
backdrop-filter that is neither `none` nor a `var(...)`, in panels.css,
screenshots.css or overlay.css. Every exception is in ALLOWED with a reason;
