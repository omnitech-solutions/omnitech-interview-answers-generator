# apps/agent-worker/src/coach-loop.test.ts

_Source: `apps/agent-worker/src/coach-loop.test.ts` (header-comment fallback)_

The live coach's worker loop: how it talks to Studio (the API token, the
cursor, a note's revisions, the pen it claims before it writes, the ledger
it keeps there) and when the worker runs it at all. Nothing here reaches a
network: the Studio is a stand-in for `fetch`.
