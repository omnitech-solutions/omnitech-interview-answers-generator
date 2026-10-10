# products/interview/src/backend/context-pack/eval/stats.ts

_Source: `products/interview/src/backend/context-pack/eval/stats.ts` (header-comment fallback)_

The arithmetic the context pack's evaluation reports with.

PROBLEM: a bare count ("31 of 36") cannot say whether a change helped or a
different question set would say the opposite. STRATEGY: every share comes
with a Wilson interval, every mean with a bootstrap interval over the
questions, and every comparison of two arms is PAIRED (the same questions
scored twice): the questions gained and lost, and McNemar's exact p for
them. COMPLEXITY: O(questions) each; the bootstrap is O(rounds x questions).

Nothing here knows what a question or a record is.
