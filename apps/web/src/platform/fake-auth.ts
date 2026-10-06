// [DOMAIN] The passwordless "local" sign-in (FAKE_AUTH_ENABLED) works in two
// ways, and the difference is a build-time one.
//
// [SAFETY] Both read `process.env["NODE_ENV"]` literally, so a Next build
// replaces it with the same constant in both: a runtime-only read would
// disagree with the compiled bypass (a production build run with
// NODE_ENV=development would still believe the bypass is on).

// Development (`next dev`): requests are the bootstrapped owner without any
// session, so nobody, the native shell included, needs to sign in.
export const localSignInBypass = () =>
  process.env["NODE_ENV"] !== "production" &&
  process.env["FAKE_AUTH_ENABLED"] === "true";

// A production build (`next start`) with FAKE_AUTH_ENABLED has the local
// provider but no bypass: a session is required, so the native shell has to
// sign in through it like anyone else.
export const localSignInNeeded = () =>
  process.env["NODE_ENV"] === "production" &&
  process.env["FAKE_AUTH_ENABLED"] === "true";
