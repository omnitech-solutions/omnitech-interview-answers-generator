# products/interview/src/backend/context-pack/eval/fixture.ts

_Source: `products/interview/src/backend/context-pack/eval/fixture.ts` (header-comment fallback)_

The held-out material of the context pack's evaluation: two invented
applications, and questions their authors did not write the ranker for.

PROBLEM: every earlier score was measured on the questions the ranking
rules were written against (the Kestrel fixture: the DEVELOPMENT set). A
number is evidence only on questions nobody tuned for. STRATEGY: each
held-out application is a folder of sources (a matrix, an employer brief, a
posting, stages with notes and transcripts, what the employer said,
research), a pack a model prepared from them ONCE and kept beside them
(`kept-pack.json`: the corpus every arm selects from), and one question
file whose gold names records by id and facts by the words the sources
say. Every gold item is checked in code (`checkQuestions`).
