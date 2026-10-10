# apps/agent-worker/src/pack-live.ts

_Source: `apps/agent-worker/src/pack-live.ts` (header-comment fallback)_

The live profiles of the context pack's benchmark (`pnpm pack:bench --live`):
one real profile, in an engine of its own.

[DOMAIN] Each run builds its own engine around ONE profile, with a store of
its own in this process's memory, so runs side by side share nothing: not a
model session, not a pack. It is here, in the agent worker, because this is
where an agent runtime may be started (rule 7) and where the engine and the
worker's own environment rules resolve; the script only asks for a profile.
