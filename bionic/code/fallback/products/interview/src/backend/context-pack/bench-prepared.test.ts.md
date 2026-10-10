# products/interview/src/backend/context-pack/bench-prepared.test.ts

_Source: `products/interview/src/backend/context-pack/bench-prepared.test.ts` (header-comment fallback)_

The context pack's benchmark in PREPARED mode, as a gate: the fixture's
whole application is prepared by the scripted model built from the
fixture's gold (bench-prepared.ts; deterministic, no network), at a large
and a small window, and the prepared pack's scores are asserted. The
"must be" numbers are exact (nothing invented, no wrong link, every
model-written record's quote verified); the others are floors, so a change
that loses one fails here. Every name and figure in the fixture is invented.
