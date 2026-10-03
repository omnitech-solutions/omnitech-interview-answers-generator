import {
  exchangeAuthorizationCode,
  getProviderConfiguration,
  type IntegrationProvider,
  verifyIntegrationState,
} from "@omnitech/platform-integrations";
import {
  ConnectedAccountVault,
  PlatformRepository,
} from "@omnitech/platform-storage";
import { getPlatformDatabase } from "@omnitech/database";
import { NextResponse } from "next/server";

import { resolvePlatformContext } from "@/src/platform/context";

function providerFrom(value: string): IntegrationProvider | null {
  return value === "google" || value === "linkedin" ? value : null;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider: providerValue } = await params;
  const provider = providerFrom(providerValue);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const signedState = url.searchParams.get("state");
  if (!provider || !code || !signedState) {
    return NextResponse.json(
      { error: "The integration callback is incomplete." },
      { status: 400 },
    );
  }
  // ADR-0006 D3: a missing signing or vault secret is an operator gap.
  const stateSecret = process.env["INTEGRATION_STATE_SECRET"];
  const tokenSecret = process.env["CONNECTED_ACCOUNT_SECRET"];
  if (!stateSecret || !tokenSecret) {
    return NextResponse.json(
      { error: "Integration secrets are not configured." },
      { status: 503 },
    );
  }
  // [SAFETY] A tampered, malformed or expired state is refused, as is one
  // signed for another workspace or member.
  let state: ReturnType<typeof verifyIntegrationState>;
  try {
    state = verifyIntegrationState(signedState, stateSecret);
  } catch {
    return NextResponse.json(
      { error: "The integration context is invalid." },
      { status: 403 },
    );
  }
  const context = await resolvePlatformContext(state.tenantSlug);
  if (
    !context ||
    state.provider !== provider ||
    context?.tenant.id !== state.tenantId ||
    context.user.id !== state.userId
  ) {
    return NextResponse.json(
      { error: "The integration context is invalid." },
      { status: 403 },
    );
  }
  // The same operator configuration gap as authorize: report it before
  // exchanging the code.
  const configuration = getProviderConfiguration(provider);
  if (!configuration) {
    return NextResponse.json(
      { error: `The ${provider} integration is not configured.` },
      { status: 503 },
    );
  }
  const redirectUri = new URL(
    `/api/integrations/${provider}/callback`,
    url.origin,
  ).toString();
  const grant = await exchangeAuthorizationCode(
    configuration,
    code,
    redirectUri,
  );
  const vault = new ConnectedAccountVault(tokenSecret);
  await new PlatformRepository(getPlatformDatabase()).saveConnectedAccount({
    userId: context.user.id,
    provider,
    providerAccountId: grant.providerAccountId,
    scopes: grant.scopes,
    accessToken: vault.encrypt(grant.accessToken),
    refreshToken: grant.refreshToken ? vault.encrypt(grant.refreshToken) : null,
    expiresAt: grant.expiresAt,
  });
  return NextResponse.redirect(
    new URL(`/t/${context.tenant.slug}/settings/integrations`, url.origin),
  );
}
