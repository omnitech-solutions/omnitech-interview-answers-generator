# products/interview/src/backend/live-session/processor.ts

_Source: `products/interview/src/backend/live-session/processor.ts` (header-comment fallback)_

The Active Session processor: ADR-0011's loop beside the agent-job loop. One
`tick` claims sessions that need processing (acquiring a lease raises the
session's fence), renews the leases it holds, and for each held session
reconciles its standing, replays new observations through the neutral core,
and starts assistance for the task revisions that need it. It also sweeps
duration-capped and purge-due sessions.

Everything per session is isolated: an error in one session is traced by its
ids and a code and never stops the others or the loop. The processor builds
no gateway and branches on no provider or model name; it holds no database
handle of its own - every read and write goes through the injected ports,
each of which opens an actor-scoped transaction for the session owner.
