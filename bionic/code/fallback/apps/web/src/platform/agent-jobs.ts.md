# apps/web/src/platform/agent-jobs.ts

_Source: `apps/web/src/platform/agent-jobs.ts` (header-comment fallback)_

The platform's agent-job use cases behind agent-api.ts: which profiles a job
may start with, who may start one for a product, and starting, reading and
resuming a job through the engine's job service. No HTTP here; the web host
submits and follows jobs and never starts a runtime (AGENTS rule 7).
