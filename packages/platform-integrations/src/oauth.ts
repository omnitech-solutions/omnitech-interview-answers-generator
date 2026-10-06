import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

export type IntegrationProvider = "google" | "linkedin";

export interface OAuthProviderConfiguration {
  provider: IntegrationProvider;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: readonly string[];
  // Whether this provider takes an S256 PKCE challenge (RFC 7636 / RFC 9700).
  pkce: boolean;
}

export interface OAuthGrant {
  providerAccountId: string;
  accessToken: string;
  refreshToken: string | null;
  scopes: string[];
  expiresAt: Date | null;
}

const stateSchema = z.object({
  provider: z.enum(["google", "linkedin"]),
  tenantId: z.uuid(),
  tenantSlug: z.string().min(1),
  userId: z.uuid(),
  expiresAt: z.number().int(),
  // The S256 challenge of this attempt's verifier; the verifier itself is
  // never in the state (it is in a URL), only in an httpOnly cookie.
  pkceChallenge: z.string().optional(),
});

export type IntegrationState = z.infer<typeof stateSchema>;

// Undefined when INTEGRATION_<P>_ID or _SECRET is missing: an operator
// configuration gap that callers report as 503 before redirecting (ADR-0006).
export function getProviderConfiguration(
  provider: IntegrationProvider,
): OAuthProviderConfiguration | undefined {
  const prefix = `INTEGRATION_${provider.toUpperCase()}`;
  const clientId = process.env[`${prefix}_ID`];
  const clientSecret = process.env[`${prefix}_SECRET`];
  if (!clientId || !clientSecret) return undefined;
  return provider === "google"
    ? {
        provider,
        clientId,
        clientSecret,
        authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        userInfoUrl: "https://openidconnect.googleapis.com/v1/userinfo",
        // OIDC profile only (ADR-0006): no product uses Google APIs yet.
        scopes: ["openid", "email", "profile"],
        // Google documents S256 PKCE for the authorization-code flow.
        pkce: true,
      }
    : {
        provider,
        clientId,
        clientSecret,
        authorizationUrl: "https://www.linkedin.com/oauth/v2/authorization",
        tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
        userInfoUrl: "https://api.linkedin.com/v2/userinfo",
        scopes: ["openid", "profile", "email"],
        // UNVERIFIED offline: LinkedIn documents PKCE for native apps; its
        // support for confidential web clients is not confirmed, so this is
        // an explicit opt-in (INTEGRATION_LINKEDIN_PKCE=1), never the default.
        pkce: process.env["INTEGRATION_LINKEDIN_PKCE"] === "1",
      };
}

export function createAuthorizationUrl(
  configuration: OAuthProviderConfiguration,
  redirectUri: string,
  state: string,
  pkceChallenge?: string,
): string {
  const url = new URL(configuration.authorizationUrl);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: configuration.clientId,
    redirect_uri: redirectUri,
    scope: configuration.scopes.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
    ...(pkceChallenge
      ? { code_challenge: pkceChallenge, code_challenge_method: "S256" }
      : {}),
  }).toString();
  return url.toString();
}

// [SAFETY] One PKCE pair per attempt: 32 random bytes (43 base64url
// characters, the RFC 7636 minimum) and its S256 challenge.
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: pkceChallengeFor(verifier) };
}

// The httpOnly cookie that holds one provider's verifier between authorize and
// callback.
export function pkceCookieName(provider: IntegrationProvider): string {
  return `integration_pkce_${provider}`;
}

function pkceChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// [SAFETY] The attempt's verifier from the callback's Cookie header, or
// undefined unless it hashes to the challenge the signed state carries: a
// missing, stale or foreign cookie yields nothing.
export function verifierFromCookie(
  cookieHeader: string | null,
  provider: IntegrationProvider,
  challenge: string | undefined,
): string | undefined {
  if (!challenge) return undefined;
  for (const part of (cookieHeader ?? "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== pkceCookieName(provider)) continue;
    const verifier = rest.join("=");
    const expected = Buffer.from(challenge);
    const actual = Buffer.from(pkceChallengeFor(verifier));
    return verifier &&
      expected.length === actual.length &&
      timingSafeEqual(expected, actual)
      ? verifier
      : undefined;
  }
  return undefined;
}

export function signIntegrationState(
  state: IntegrationState,
  secret: string,
): string {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyIntegrationState(
  value: string,
  secret: string,
  now = Date.now(),
): IntegrationState {
  const [payload, suppliedSignature] = value.split(".");
  if (!payload || !suppliedSignature) throw new Error("Invalid OAuth state.");
  const expectedSignature = createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    throw new Error("Invalid OAuth state.");
  }
  const state = stateSchema.parse(
    JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
  );
  if (state.expiresAt < now) throw new Error("OAuth state has expired.");
  return state;
}

export async function exchangeAuthorizationCode(
  configuration: OAuthProviderConfiguration,
  code: string,
  redirectUri: string,
  codeVerifier?: string,
): Promise<OAuthGrant> {
  // A PKCE provider is never asked for a token without the attempt's verifier.
  if (configuration.pkce && !codeVerifier) {
    throw new Error("The PKCE verifier is missing.");
  }
  const response = await fetch(configuration.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      redirect_uri: redirectUri,
      ...(configuration.pkce && codeVerifier
        ? { code_verifier: codeVerifier }
        : {}),
    }),
  });
  if (!response.ok) throw new Error("The provider rejected the OAuth grant.");
  const token = z
    .object({
      access_token: z.string(),
      refresh_token: z.string().optional(),
      expires_in: z.number().optional(),
      scope: z.string().optional(),
    })
    .parse(await response.json());
  const profileResponse = await fetch(configuration.userInfoUrl, {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!profileResponse.ok) {
    throw new Error("The provider profile could not be retrieved.");
  }
  const profile = z
    .object({ sub: z.string() })
    .parse(await profileResponse.json());
  return {
    providerAccountId: profile.sub,
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    scopes: token.scope?.split(" ").filter(Boolean) ?? [
      ...configuration.scopes,
    ],
    expiresAt: token.expires_in
      ? new Date(Date.now() + token.expires_in * 1000)
      : null,
  };
}
