import "./server-only";
import {
  createAuthorizationUrl,
  createPkcePair,
  exchangeAuthorizationCode,
  getProviderConfiguration,
  type IntegrationProvider,
  signIntegrationState,
  verifierFromCookie,
  verifyIntegrationState,
} from "@omnitech/platform-integrations";
import { ConnectedAccountVault } from "@omnitech/platform-storage";
import { resolvePlatformContext } from "./context";
import { hostSettings } from "./settings";
import { platformRepository } from "./store";

// Connecting a member's provider account (ADR-0006): the use cases behind the
// authorize and callback routes, which own only the HTTP.

export const ATTEMPT_SECONDS = 10 * 60;

export function providerFrom(value: string): IntegrationProvider | null {
  return value === "google" || value === "linkedin" ? value : null;
}

export const callbackPath = (provider: IntegrationProvider) =>
  `/api/integrations/${provider}/callback`;

// ADR-0006 D3: nothing is signed and no token is stored without both secrets.
export function integrationSecrets(): { state: string; vault: string } | null {
  const { integrationStateSecret, connectedAccountSecret } = hostSettings();
  return integrationStateSecret && connectedAccountSecret
    ? { state: integrationStateSecret, vault: connectedAccountSecret }
    : null;
}

type Member = NonNullable<Awaited<ReturnType<typeof resolvePlatformContext>>>;

/** Where to send the browser, and the verifier to keep for the callback. */
export function startConnection(input: {
  provider: IntegrationProvider;
  member: Member;
  origin: string;
  stateSecret: string;
}): { url: string; verifier?: string } | null {
  // A missing client id or secret is an operator gap, reported first.
  const configuration = getProviderConfiguration(input.provider);
  if (!configuration) return null;
  const redirectUri = new URL(
    callbackPath(input.provider),
    input.origin,
  ).toString();
  // [SAFETY] RFC 9700 PKCE: the verifier lives only in an httpOnly cookie
  // scoped to this provider's callback; the URL carries just its S256
  // challenge, and the signed state repeats the challenge to tie the cookie
  // to this attempt.
  const pkce = configuration.pkce ? createPkcePair() : undefined;
  const state = signIntegrationState(
    {
      provider: input.provider,
      tenantId: input.member.tenant.id,
      tenantSlug: input.member.tenant.slug,
      userId: input.member.user.id,
      expiresAt: Date.now() + ATTEMPT_SECONDS * 1000,
      ...(pkce ? { pkceChallenge: pkce.challenge } : {}),
    },
    input.stateSecret,
  );
  return {
    url: createAuthorizationUrl(
      configuration,
      redirectUri,
      state,
      pkce?.challenge,
    ),
    ...(pkce ? { verifier: pkce.verifier } : {}),
  };
}

export type ConnectionRefusal =
  | "invalid-context"
  | "not-configured"
  | "unverified-attempt"
  | "provider-refused";

/** Completes an attempt: the grant is stored encrypted for the member. */
export async function completeConnection(input: {
  provider: IntegrationProvider;
  code: string;
  signedState: string;
  origin: string;
  cookie: string | null;
  secrets: { state: string; vault: string };
}): Promise<
  { ok: true; tenantSlug: string } | { ok: false; refusal: ConnectionRefusal }
> {
  const { provider } = input;
  // [SAFETY] A tampered, malformed or expired state is refused, as is one
  // signed for another workspace or member.
  let state: ReturnType<typeof verifyIntegrationState>;
  try {
    state = verifyIntegrationState(input.signedState, input.secrets.state);
  } catch {
    return { ok: false, refusal: "invalid-context" };
  }
  const member = await resolvePlatformContext(state.tenantSlug);
  if (
    !member ||
    state.provider !== provider ||
    member.tenant.id !== state.tenantId ||
    member.user.id !== state.userId
  )
    return { ok: false, refusal: "invalid-context" };
  // The same operator gap as authorize, before the code is exchanged.
  const configuration = getProviderConfiguration(provider);
  if (!configuration) return { ok: false, refusal: "not-configured" };
  const redirectUri = new URL(callbackPath(provider), input.origin).toString();
  // [SAFETY] RFC 9700 PKCE: refused before any token request unless the
  // verifier cookie belongs to this attempt.
  const verifier = verifierFromCookie(
    input.cookie,
    provider,
    state.pkceChallenge,
  );
  if (configuration.pkce && !verifier)
    return { ok: false, refusal: "unverified-attempt" };
  let grant: Awaited<ReturnType<typeof exchangeAuthorizationCode>>;
  try {
    grant = await exchangeAuthorizationCode(
      configuration,
      input.code,
      redirectUri,
      configuration.pkce ? verifier : undefined,
    );
  } catch {
    // The provider's reply can quote the code; none of it is surfaced.
    return { ok: false, refusal: "provider-refused" };
  }
  const vault = new ConnectedAccountVault(input.secrets.vault);
  await (await platformRepository()).saveConnectedAccount({
    userId: member.user.id,
    provider,
    providerAccountId: grant.providerAccountId,
    scopes: grant.scopes,
    accessToken: vault.encrypt(grant.accessToken),
    refreshToken: grant.refreshToken ? vault.encrypt(grant.refreshToken) : null,
    expiresAt: grant.expiresAt,
  });
  return { ok: true, tenantSlug: member.tenant.slug };
}
