# products/interview/src/backend/context-pack/eval/replay-material.ts

_Source: `products/interview/src/backend/context-pack/eval/replay-material.ts` (header-comment fallback)_

A person's material read from files, as the session of a recorded call
would hold it, so the call can be replayed through the live coach WITH its
context pack (apps/agent-worker/src/coach-replay.ts).

PROBLEM: a replayed coach was given a plan and nothing else, so what its
notes say could not be judged against the person's record. STRATEGY: the
files (an experience matrix, an employer brief, optionally the application
with its stages, the person's preferences and a pack a model prepared) are
read into the same `SessionContext` the database reader gives a live
session. Nothing is selected or ranked here: the coach's own context
(coach/context.ts) prepares the pack from it, on the one path every coach
takes. No model is called.
COMPLEXITY: one read per file.
