# products/interview/src/frontend/studio/live/overlay/overlay-model.ts

_Source: `products/interview/src/frontend/studio/live/overlay/overlay-model.ts` (header-comment fallback)_

What the overlay card says, derived from the one session store's snapshot and
view model. Pure: no fetching, no timers, no React. Everything shown is read
from the session record, the observations or the actions; nothing is
invented (a label the read model lacks is left out, not guessed).
