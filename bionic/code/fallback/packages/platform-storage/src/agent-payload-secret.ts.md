# packages/platform-storage/src/agent-payload-secret.ts

_Source: `packages/platform-storage/src/agent-payload-secret.ts` (header-comment fallback)_

The one definition of which secret encrypts agent prompt payloads. The
fallback to the connected-account key is kept for single-machine local
development only; set AGENT_PAYLOAD_SECRET wherever the two keys should be
rotated or leaked independently.
