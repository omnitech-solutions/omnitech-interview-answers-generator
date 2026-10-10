# products/interview/src/backend/context-pack/readers.ts

_Source: `products/interview/src/backend/context-pack/readers.ts` (header-comment fallback)_

What a briefing and a document read of an application's context pack.

PROBLEM: a briefing is written for one stage and a resume for one posting,
and until now each gathered its own facts: the whole matrix, the posting as
one text. Neither knew what the employer asks for line by line, which
achievement is evidence for which requirement, where the record has a gap,
or what an earlier stage asked. STRATEGY: both read the pack through its
own projection (`briefing`, `document`; recipe.ts) and through the engine's
read-only lookups (`find`, `related`), which is how the Studio gathers what
it hands a writer that cannot be offered the pack as a tool (Claude Code
and Codex run their own tools). Nothing here asks a model, and every fact
handed over keeps the pointer it is cited by.
With no pack prepared by a model there is no fit and nothing extracted:
each function then answers `null`, and its reader writes from what it
always wrote from.
