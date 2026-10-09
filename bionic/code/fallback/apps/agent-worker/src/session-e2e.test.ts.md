# apps/agent-worker/src/session-e2e.test.ts

_Source: `apps/agent-worker/src/session-e2e.test.ts` (header-comment fallback)_

The Active Session assistance path end to end (ADR-0016), without a
database or a provider: the REAL processor, the REAL AI engine and
the REAL session agent port, with a FAKE runtime adapter in the shape of each
provider (claude-code, codex) and a fake direct model for the text-only
stages, over the product's in-memory session world. It shows the same
answer, claim validation, cancel and publish behaviour on either provider, a
screenshot reaching the runtime only through the verifying loader, and
every refusal failing closed. A real provider, a real database and real
pixels are outside what this can show (see the *.integration tests).
