# apps/agent-worker/src/session-loop.ts

_Source: `apps/agent-worker/src/session-loop.ts` (header-comment fallback)_

The Active Session loop (ADR-0011), bounded separately from the agent-job
loop: its own try/catch, its own backoff, and its own exit. One tick claims,
renews and processes sessions; the processor bounds failed lease renewals
per session. The loop logs only a content-free error name, never a message,
and closes the processor (releasing its leases) when it stops.
