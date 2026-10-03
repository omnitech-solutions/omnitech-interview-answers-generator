# apps/web/app/api/[[...route]]/session-ingest.test.ts

_Source: `apps/web/app/api/[[...route]]/session-ingest.test.ts` (header-comment fallback)_

@vitest-environment node
ADR-0011 / ADR-0012: the capture companion's ingest route is reached through
the shell with a credential alone (no sign-in session), every other session
route needs tenant membership first (ADR-0004), and the shell adds nothing
that would reject or reshape a credential-only request.
