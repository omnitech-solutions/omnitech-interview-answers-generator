# products/interview/src/backend/context-pack/stage.ts

_Source: `products/interview/src/backend/context-pack/stage.ts` (header-comment fallback)_

The context pack resolved for one STAGE of an application.

PROBLEM: an application has several stages, each with its own notes,
people and transcripts, and a question in the technical round should be
answered from that round's preparation first. STRATEGY: nothing is ranked
here. The brief's sources are scoped to the stage BEFORE anything is
linked, prepared, selected or arranged (brief-sources.ts): a later stage's
records are left out, and of two records that match a question equally the
stage's own leads, an earlier stage's follows, the application's comes
after (the engine breaks an equal match by priority). What bears on the
question more still comes first: a stage's note said in passing never
displaces the note that answers the question. The pack then selects as it
always does (pack.ts); this file adds what a view shows of the stage.
COMPLEXITY: one prepare per stage asked for; nothing per question beyond
the pack's own.
