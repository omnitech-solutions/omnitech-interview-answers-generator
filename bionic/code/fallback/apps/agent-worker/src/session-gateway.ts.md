# apps/agent-worker/src/session-gateway.ts

_Source: `apps/agent-worker/src/session-gateway.ts` (header-comment fallback)_

The worker's own AiExecutionGateway for the Active Session loop (ADR-0011,
ADR-0012). It is composed from the same environment model settings as the web
host (resolveDefaultLanguageModel) but never shared with it: the worker owns
its gateway, names profiles and never branches on a provider or model.

Locality is DECLARED by the environment (rule:declared-profile-locality), never
inferred. The fast profile serves permitted-remote sessions and carries the
model's declared locality; the device profile exists only when that declared
locality is `device`, so a device-only session can only ever reach a model
the environment declared to run on this device.
