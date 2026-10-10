# apps/agent-worker/src/worker-loops.ts

_Source: `apps/agent-worker/src/worker-loops.ts` (header-comment fallback)_

The loops the worker runs side by side: how each is built from the host's
shared things, the table that registers them, and the runner that keeps one
loop's failure from stopping the others.
