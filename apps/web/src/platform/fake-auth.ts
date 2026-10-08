import "./server-only";
// [DOMAIN] The passwordless "local" sign-in (FAKE_AUTH_ENABLED) works in two
// ways, and the difference is a build-time one.
//
// [SAFETY] Both read `process.env["NODE_ENV"]` literally, so a Next build
// replaces it with the same constant in both: a runtime-only read would
// disagree with the compiled bypass (a production build run with
// NODE_ENV=development would still believe the bypass is on).

// The fixed identity of the passwordless local sign-in.
export const LOCAL_USER_EMAIL = "local@omnitech.test";

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

// [DOMAIN] "Continue as local user" is honest only where Studio really runs
// on this computer: the server allows the passwordless provider
// (FAKE_AUTH_ENABLED) AND the request names a loopback host.
//
// [SAFETY] A Host header is client-supplied, so this is a statement about
// the address the server was asked for, not a proof of the peer. A proxy that
// forwards a request from elsewhere says so with X-Forwarded-*; any such
// header naming a non-loopback origin turns the offer off.
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;
const LOOPBACK_ADDRESS = /^(127\.0\.0\.1|::1|\[::1\]|::ffff:127\.0\.0\.1)$/i;

export function isLoopbackHost(host: string | null | undefined): boolean {
  return typeof host === "string" && LOOPBACK_HOST.test(host.trim());
}

// [SAFETY] An operator's assertion that every client of this server is on this
// machine (Docker publishes the port on 127.0.0.1 only, but inside the container
// each client arrives from the bridge gateway, which Next reports as
// X-Forwarded-For). It silences ONLY the forwarded client address: a non-loopback
// Host or a public X-Forwarded-Host (a real reverse proxy) still turns the offer
// off. Only the exact value `true` counts.
const clientsAssertedLocal = () =>
  process.env["AUTH_ASSUME_LOOPBACK_CLIENTS"] === "true";

const forwardedFromElsewhere = (headers: Headers): boolean => {
  const host = headers.get("x-forwarded-host");
  if (host !== null && !isLoopbackHost(host)) return true;
  if (clientsAssertedLocal()) return false;
  const clients = headers.get("x-forwarded-for");
  return (
    clients
      ?.split(",")
      .some((client) => !LOOPBACK_ADDRESS.test(client.trim())) ?? false
  );
};

export function localSignInAvailable(headers: Headers | undefined): boolean {
  if (process.env["FAKE_AUTH_ENABLED"] !== "true" || !headers) return false;
  return (
    isLoopbackHost(headers.get("host")) && !forwardedFromElsewhere(headers)
  );
}

// The local provider's `authorize` rule: the same truth as the offer.
export const allowLocalSignIn = localSignInAvailable;
