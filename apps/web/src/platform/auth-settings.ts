import "./server-only";
// [DOMAIN] The two Auth.js settings that depend on where the server runs.
// Both read an environment passed in (the process's by default) when called,
// never at import, so `next build`, which has no AUTH_SECRET, cannot fail here.

// A fixed string in a public repository: a session signed with it can be forged
// by anyone, so it exists only for the passwordless local sign-in.
export const DEVELOPMENT_AUTH_SECRET =
  "development-only-auth-secret-change-before-deployment";

type Environment = Readonly<Record<string, string | undefined>>;

// [SAFETY] AU-SEC-01: the configured secret, else the committed one only where
// FAKE_AUTH_ENABLED says this is a local development setup. Anywhere else (a
// production build, or a staging host that is not NODE_ENV=production) there
// is no secret, and Auth.js refuses to sign or read a session; the server also
// refuses to start (instrumentation-node.ts).
export function resolveAuthSecret(
  env: Environment = process.env,
): string | undefined {
  if (env["AUTH_SECRET"]) return env["AUTH_SECRET"];
  return env["NODE_ENV"] !== "production" && env["FAKE_AUTH_ENABLED"] === "true"
    ? DEVELOPMENT_AUTH_SECRET
    : undefined;
}

// [SAFETY] AU-SEC-03: Auth.js builds callback URLs from the request's Host
// header when it trusts it, which is safe only behind a proxy that sets it or
// when the server is not reachable from elsewhere. Trusted by default only for
// the local setup (`next dev`, or FAKE_AUTH_ENABLED, whose server binds
// 127.0.0.1); a hosted production server needs AUTH_TRUST_HOST=true, and
// AUTH_TRUST_HOST=false switches it off anywhere.
export function resolveTrustHost(env: Environment = process.env): boolean {
  const explicit = env["AUTH_TRUST_HOST"];
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  if (explicit !== undefined && explicit !== "") return false;
  return (
    env["NODE_ENV"] !== "production" || env["FAKE_AUTH_ENABLED"] === "true"
  );
}
