# packages/platform-storage/src/agent-job-private.test.ts

_Source: `packages/platform-storage/src/agent-job-private.test.ts` (header-comment fallback)_

ADR-0012 "Agent jobs": a session's job carries an immutable private marker,
admitted only to its creator and the agent worker. fixture_member is
NOSUPERUSER NOBYPASSRLS, so forced row-level security binds it.
