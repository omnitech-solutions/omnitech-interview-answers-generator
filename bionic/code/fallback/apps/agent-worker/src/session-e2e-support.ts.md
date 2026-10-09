# apps/agent-worker/src/session-e2e-support.ts

_Source: `apps/agent-worker/src/session-e2e-support.ts` (header-comment fallback)_

Test support for the Active Session end-to-end suites: the REAL processor,
the REAL AI engine and the REAL session agent port, with a FAKE
AgentRuntimeAdapter (claude-shaped or codex-shaped) and a FAKE direct-model
provider, over the product's in-memory session world. No database, no
provider, no network. Contents are synthetic and carry canaries so a suite
can prove nothing leaks into traces or errors.
