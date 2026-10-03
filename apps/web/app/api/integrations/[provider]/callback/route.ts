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
  const stateSecret = process.env["INTEGRATION_STATE_SECRET"];
  const tokenSecret = process.env["CONNECTED_ACCOUNT_SECRET"];
  if (!provider || !code || !signedState || !stateSecret || !tokenSecret) {
    return NextResponse.json(
      { error: "The integration callback is incomplete." },
      { status: 400 },
    );
  }
  const state = verifyIntegrationState(signedState, stateSecret);
  const context = await resolvePlatformContext(state.tenantSlug);
  if (
    state.provider !== provider ||
    context?.tenant.id !== state.tenantId ||
    context.user.id !== state.userId
  ) {
    return NextResponse.json(
      { error: "The integration context is invalid." },
      { status: 403 },
    );
  }
  const redirectUri = new URL(
    `/api/integrations/${provider}/callback`,
    url.origin,
  ).toString();
  const grant = await exchangeAuthorizationCode(
    getProviderConfiguration(provider),
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
