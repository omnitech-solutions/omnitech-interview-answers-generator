import {
  type IntegrationProvider,
  pkceCookieName,
} from "@omnitech/platform-integrations";
import { NextResponse } from "next/server";

import {
  type ConnectionRefusal,
  callbackPath,
  completeConnection,
  integrationSecrets,
  providerFrom,
} from "@/src/platform/integrations";

// [SAFETY] The verifier cookie is cleared on every outcome that got as far as
// reading it, so the same callback URL cannot be replayed.
function withSpentVerifier(
  response: NextResponse,
  provider: IntegrationProvider,
) {
  response.cookies.set(pkceCookieName(provider), "", {
    httpOnly: true,
    path: callbackPath(provider),
    maxAge: 0,
  });
  return response;
}

// What each refusal answers, and whether the attempt's verifier is spent.
const REFUSALS: Readonly<
  Record<
    ConnectionRefusal,
    {
      status: number;
      error: (provider: IntegrationProvider) => string;
      spent: boolean;
    }
  >
> = {
  "invalid-context": {
    status: 403,
    error: () => "The integration context is invalid.",
    spent: false,
  },
  "not-configured": {
    status: 503,
    error: (provider) => `The ${provider} integration is not configured.`,
    spent: false,
  },
  "unverified-attempt": {
    status: 403,
    error: () => "The integration context is invalid.",
    spent: true,
  },
  "provider-refused": {
    status: 502,
    error: () => "The provider did not complete the connection.",
    spent: true,
  },
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const provider = providerFrom((await params).provider);
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const signedState = url.searchParams.get("state");
  if (!provider || !code || !signedState) {
    return NextResponse.json(
      { error: "The integration callback is incomplete." },
      { status: 400 },
    );
  }
  const secrets = integrationSecrets();
  if (!secrets) {
    return NextResponse.json(
      { error: "Integration secrets are not configured." },
      { status: 503 },
    );
  }
  const connected = await completeConnection({
    provider,
    code,
    signedState,
    origin: url.origin,
    cookie: request.headers.get("cookie"),
    secrets,
  });
  if (!connected.ok) {
    const refusal = REFUSALS[connected.refusal];
    const response = NextResponse.json(
      { error: refusal.error(provider) },
      { status: refusal.status },
    );
    return refusal.spent ? withSpentVerifier(response, provider) : response;
  }
  return withSpentVerifier(
    NextResponse.redirect(
      new URL(`/t/${connected.tenantSlug}/settings/integrations`, url.origin),
    ),
    provider,
  );
}
