import { createHmac, timingSafeEqual } from "node:crypto";

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
  tenantId: z.string().uuid(),
  tenantSlug: z.string().min(1),
  userId: z.string().uuid(),
  expiresAt: z.number().int(),
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
      }
    : {
        provider,
        clientId,
        clientSecret,
        authorizationUrl: "https://www.linkedin.com/oauth/v2/authorization",
        tokenUrl: "https://www.linkedin.com/oauth/v2/accessToken",
        userInfoUrl: "https://api.linkedin.com/v2/userinfo",
        scopes: ["openid", "profile", "email"],
      };
}

export function createAuthorizationUrl(
  configuration: OAuthProviderConfiguration,
  redirectUri: string,
  state: string,
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
  }).toString();
  return url.toString();
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
): Promise<OAuthGrant> {
  const response = await fetch(configuration.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: configuration.clientId,
      client_secret: configuration.clientSecret,
      redirect_uri: redirectUri,
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
