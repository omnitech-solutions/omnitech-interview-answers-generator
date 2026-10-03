# products/interview/src/backend/live-session/worker-entry.ts

_Source: `products/interview/src/backend/live-session/worker-entry.ts` (header-comment fallback)_

The backend-only public entrypoint of the Active Session worker side
(`@omnitech/product-interview/session-worker`). The worker app composes the
gateway and its profiles itself and hands the gateway in; this entrypoint
composes everything else - the cross-tenant claim, the owner-checked
repository and fenced writes, the purge, the baseline interview policy and
the processor - over the real PlatformDatabase. The claim lives in the
product (session-claim.ts owns app.session_worker), so the worker app needs
nothing from the cross-tenant worker storage entrypoint for sessions.

It imports no Next.js and no frontend code, and never builds a gateway: the
host builds one from the same profile and model configuration source as the
web host and passes it in (rule:model-calls-gateway-routed).
