# products/interview/src/frontend/studio/live/accessible-names.test.tsx

_Source: `products/interview/src/frontend/studio/live/accessible-names.test.tsx` (header-comment fallback)_

Every control in every major state of the session UI has an accessible name,
and the ARIA wiring between controls and what they name resolves. No axe
library is a dependency here, so this walks the DOM itself with the part of
the accessible-name computation these views use: aria-labelledby, aria-label,
native labels, content (skipping aria-hidden), then title. It does not judge
contrast, focus order or screen-reader speech (unobserved without a browser).
