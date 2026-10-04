import {
  createAuthorizationUrl,
  getProviderConfiguration,
  type IntegrationProvider,
  signIntegrationState,
} from "@omnitech/platform-integrations";
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
  const requestUrl = new URL(request.url);
  const tenantSlug = requestUrl.searchParams.get("tenant") ?? "";
  const context = await resolvePlatformContext(tenantSlug);
  if (!provider || !context) {
    return NextResponse.json(
      { error: "Integration not found." },
      { status: 404 },
    );
  }
  // The callback signs nothing and stores no token without these, so the
  // browser is never sent to a provider it could not come back from.
  const secret = process.env["INTEGRATION_STATE_SECRET"];
  if (!secret || !process.env["CONNECTED_ACCOUNT_SECRET"]) {
    return NextResponse.json(
      { error: "Integration secrets are not configured." },
      { status: 503 },
    );
  }
  // A missing client id or secret is an operator configuration gap: report it
  // before sending the browser to the provider.
  const configuration = getProviderConfiguration(provider);
  if (!configuration) {
    return NextResponse.json(
      { error: `The ${provider} integration is not configured.` },
      { status: 503 },
    );
  }
  const redirectUri = new URL(
    `/api/integrations/${provider}/callback`,
    requestUrl.origin,
  ).toString();
  const state = signIntegrationState(
    {
      provider,
      tenantId: context.tenant.id,
      tenantSlug: context.tenant.slug,
      userId: context.user.id,
      expiresAt: Date.now() + 10 * 60 * 1000,
    },
    secret,
  );
  return NextResponse.redirect(
    createAuthorizationUrl(configuration, redirectUri, state),
  );
}
