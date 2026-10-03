# products/interview/src/frontend/studio/live/layout-rules.test.ts

_Source: `products/interview/src/frontend/studio/live/layout-rules.test.ts` (header-comment fallback)_

Layout and theme rules for the live session stylesheets, checked from the
CSS itself because no browser runs here (phone-width and dark-mode rendering
stay unobserved until someone opens it). Rules: nothing fixed wider than a
360 px phone can hold, grids that wrap, no sideways page scroll, 40 px touch
targets, reduced motion honoured, tokens only for colour, and a visible focus
ring on every interactive control.
