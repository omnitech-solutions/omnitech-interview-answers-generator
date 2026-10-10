# products/interview/src/backend/context-pack/eval/answers.ts

_Source: `products/interview/src/backend/context-pack/eval/answers.ts` (header-comment fallback)_

The answer level of the context pack's evaluation: the same model answers
the same question, given different context, and the ANSWER is scored.

PROBLEM: "the right record ranked first" does not say a model then answers
better; and the serious rival of any selection is to hand the model
everything. STRATEGY: seven arms that differ only in what the model is
given: nothing; the whole material (as far as the model's window holds);
BM25's choice; the pack as it was; the pack with the adopted options; the
gold records (the ceiling); and, for an agent runtime, the pack offered as
tools. The answer is scored in CODE first: the pointers it cites exist and
are of a right employer, the gold points it states, the figures and
employers it states that nothing it was given says, whether it says "I have
nothing" exactly when it should, and what it cost. A model judge is a
second opinion only (judge.ts).
COMPLEXITY: arms x questions model calls; each is kept by its content hash,
so a run resumes and an unchanged prompt costs nothing.
