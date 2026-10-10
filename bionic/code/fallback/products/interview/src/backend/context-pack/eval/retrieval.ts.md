# products/interview/src/backend/context-pack/eval/retrieval.ts

_Source: `products/interview/src/backend/context-pack/eval/retrieval.ts` (header-comment fallback)_

The retrieval level of the context pack's evaluation: for every question,
what each arm selects, scored against gold records.

PROBLEM: "the right fact came first" on the questions the rules were tuned
on says little. STRATEGY: the held-out questions carry gold RECORDS with
grades, so the standard measures apply: right-first (Success@1), MRR,
Recall@1/3/5, nDCG@10; beside them what this product must never do (hand a
wrong employer's work over, leak a device-only source, read a stale
requirement) and what it should do when nothing answers (give nothing).
Every share has a Wilson interval, and two arms are compared question by
question (McNemar's exact test).
COMPLEXITY: arms x questions resolves; milliseconds each.
