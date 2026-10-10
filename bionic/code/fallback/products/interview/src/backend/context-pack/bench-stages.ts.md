# products/interview/src/backend/context-pack/bench-stages.ts

_Source: `products/interview/src/backend/context-pack/bench-stages.ts` (header-comment fallback)_

The context pack's benchmark with STAGES: the same fixed brief, with each
stage's own material (people, notes, a transcript, an outcome), what the
employer said and the research documents, and a second gold file of
questions only stage scope can answer.

PROBLEM: "a second stage has its own material and the pack filters by
stage" has to be a number too, and adding that material must not cost the
first benchmark a question. STRATEGY: the pack is prepared once per stage
through the same door a live session uses (`prepareStagePack`); the stage
gold is scored on the coach projection, and the first benchmark's gold is
scored again on the same packs, each question at the stage that asks it,
with the same scorer. No model is called anywhere.
