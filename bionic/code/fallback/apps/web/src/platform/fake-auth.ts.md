# apps/web/src/platform/fake-auth.ts

_Source: `apps/web/src/platform/fake-auth.ts` (header-comment fallback)_

[DOMAIN] The passwordless "local" sign-in (FAKE_AUTH_ENABLED) works in two
ways, and the difference is a build-time one.

[SAFETY] Both read `process.env["NODE_ENV"]` literally, so a Next build
replaces it with the same constant in both: a runtime-only read would
disagree with the compiled bypass (a production build run with
NODE_ENV=development would still believe the bypass is on).
