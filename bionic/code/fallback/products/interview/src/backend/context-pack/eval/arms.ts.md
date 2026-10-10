# products/interview/src/backend/context-pack/eval/arms.ts

_Source: `products/interview/src/backend/context-pack/eval/arms.ts` (header-comment fallback)_

The arms of the context pack's evaluation: each is one way of choosing what
a reader is given for a question, over the SAME records.

PROBLEM: "the pack is effective" means "more effective than something".
STRATEGY: every arm answers the same call (an application, a question, a
projection) with an ordered selection of the pack's records, so one scorer
reads them all. The pack's own arms differ only in the recipe they select
with (pack.ts takes it as an option); BM25 and "everything" are written
here, for the benchmark only, and ship nowhere. Three deliberately broken
selectors prove the gate can fail.
COMPLEXITY: one prepare per (application, stage, reader, arm), kept; then
one resolve per question.
