# products/interview/src/backend/context-pack/bench.ts

_Source: `products/interview/src/backend/context-pack/bench.ts` (header-comment fallback)_

The context pack's benchmark: a fixed brief, fixed questions and a gold
file, scored the same way run after run, so a change to the recipe or the
sources can be seen to help or to hurt.

PROBLEM: "the pack is better" has to be a number. STRATEGY: prepare the
pack from a brief (an experience matrix, an employer brief, preference
lines), resolve every gold question under a projection, and count how
often the fact that leads a slot is one the gold file accepts. No model is
called anywhere: the sources are structured and selection is code.
COMPLEXITY: one prepare, then one resolve per question and projection.

[DOMAIN] The gold file names what should lead by what it SAYS, never by a
record's identity: an evidence record by its employer (and, where one
achievement matters, words it must contain), a prep note or a preference by
the words it starts with. A change to how records are identified or
composed therefore leaves the gold standing.
