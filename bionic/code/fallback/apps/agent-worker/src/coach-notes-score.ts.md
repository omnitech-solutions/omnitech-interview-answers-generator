# apps/agent-worker/src/coach-notes-score.ts

_Source: `apps/agent-worker/src/coach-notes-score.ts` (header-comment fallback)_

What a replayed coach's note SAYS, scored against what was expected of it.

PROBLEM: a replay scored WHEN the coach acts; nothing said whether the note
it then wrote drew on the right employer's record, or put a figure in the
person's mouth that nobody gave it. STRATEGY: three checks in code, each on
what the coach's own verifier already marked (reply.ts): which employers the
note's verified claims belong to, whether the facts it was given held the
right employer's at all, and which figures and employer names it states
that were neither in those facts nor said in the call. No model judges
anything here, so the same note always gets the same score.
COMPLEXITY: O(note + facts + conversation) per question.
