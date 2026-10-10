# products/interview/src/backend/context-pack/bench-prepared.ts

_Source: `products/interview/src/backend/context-pack/bench-prepared.ts` (header-comment fallback)_

The context pack's benchmark with a pack a MODEL prepared: the fixture's
whole application (the posting, the research, what the employer said, both
stages' notes and the transcript) read by a profile, kept, and scored.

PROBLEM: "extraction is right and the pack got better" has to be a number
that a gate can assert and that a real model can be held to. STRATEGY: the
same run for both. In the gate the profile is a SCRIPTED model built from
the fixture's gold (deterministic, no network): it answers each piece with
the gold records whose words are in that piece, adds proposals the source
does not say, and proposes ties the recipe forbids, so the checks are
exercised. Live, the profile is a real one. Either way the scores are read
from the pack the engine kept: what was found against the gold, what was
kept without a quote (must be none), which ties are wrong (must be none),
what a later stage's remote reader is given of an earlier one (nothing of a
device-only transcript; all of one that may leave this machine), and how
many calls it took.
