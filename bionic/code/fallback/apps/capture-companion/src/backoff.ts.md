# apps/capture-companion/src/backoff.ts

_Source: `apps/capture-companion/src/backoff.ts` (header-comment fallback)_

Exponential backoff with injected jitter, so a reconnect storm after a
Studio outage spreads out and tests are deterministic.
