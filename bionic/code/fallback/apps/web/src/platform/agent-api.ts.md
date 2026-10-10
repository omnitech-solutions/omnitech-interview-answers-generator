# apps/web/src/platform/agent-api.ts

_Source: `apps/web/src/platform/agent-api.ts` (header-comment fallback)_

The platform agent-job HTTP routes (profiles, create, events, cancel,
resume): Hono wiring only. Each resolves the tenant member, validates the
request and delegates to agent-jobs.ts.
