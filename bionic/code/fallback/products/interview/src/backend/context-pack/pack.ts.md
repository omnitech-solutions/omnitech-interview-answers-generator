# products/interview/src/backend/context-pack/pack.ts

_Source: `products/interview/src/backend/context-pack/pack.ts` (header-comment fallback)_

The context pack (ADR-0038): a session's approved material, prepared once
into attributable records, then resolved for one question.

PROBLEM: the same question must find the same facts whoever asks (the
coach, an answer, the view a person inspects), and every fact must say
where it came from. STRATEGY: two steps, both the AI engine's. `prepare`
turns the material into records (no model for structured material, and the
result is reused while the material's revisions stand). `resolve` selects
for one question under a named projection: pure, repeatable, and every
record left out carries its reason.
