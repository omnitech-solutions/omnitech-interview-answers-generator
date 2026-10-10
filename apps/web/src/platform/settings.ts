// The host settings the shell's own server modules read from the environment,
// in one place. Read when asked, never at import: `next build` has no secrets,
// and a test sets them per case.
//
// [SAFETY] NODE_ENV and NEXT_PUBLIC_* are read literally, so a Next build
// replaces them with the same constants here as everywhere else. The sign-in
// rules (auth-settings.ts, fake-auth.ts) and the engine's model configuration
// (ai.ts) keep their own reads beside the rules that explain them.
const set = (value: string | undefined) => value?.trim() || undefined;

export const hostSettings = () => ({
  /** The interview run queue opens its own connection with this. */
  databaseUrl: process.env["DATABASE_URL"],
  /** Signs the state of a connected-account attempt (ADR-0006). */
  integrationStateSecret: process.env["INTEGRATION_STATE_SECRET"],
  /** Encrypts a connected account's tokens at rest (ADR-0006). */
  connectedAccountSecret: process.env["CONNECTED_ACCOUNT_SECRET"],
  /** The internal agent worker's bearer for a job's events. */
  agentServiceToken: process.env["AGENT_SERVICE_TOKEN"],
  /** Where the packed on-device model is served from; absent, it is not. */
  onDeviceModelDirectory: process.env["ON_DEVICE_MODEL_DIR"],
  /** Whether this build pins an on-device model. */
  onDeviceModel: Boolean(process.env["NEXT_PUBLIC_ON_DEVICE_MODEL_SHA256"]),
  /** The model the assistant starts on, when the host names one. */
  assistantDefaultModel: process.env["INTERVIEW_ASSISTANT_DEFAULT_MODEL"],
  /** The profile a context pack is prepared with, when the host names one. */
  packProfile: set(process.env["INTERVIEW_PACK_PROFILE"]),
  /** A local development setup: the passwordless owner outside production. */
  localDevelopment:
    process.env["NODE_ENV"] !== "production" &&
    process.env["FAKE_AUTH_ENABLED"] === "true",
  /** The public address Auth.js was told it is served at. */
  authUrl: process.env["AUTH_URL"] ?? process.env["NEXTAUTH_URL"],
});
