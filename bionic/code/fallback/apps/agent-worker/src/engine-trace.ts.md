# apps/agent-worker/src/engine-trace.ts

_Source: `apps/agent-worker/src/engine-trace.ts` (header-comment fallback)_

Where this worker's AI runs are kept (ADR-0037). One decision for both
loops: the session loop's model calls and the job loop's agent runs are kept
the same way, in the same place, or not at all.
