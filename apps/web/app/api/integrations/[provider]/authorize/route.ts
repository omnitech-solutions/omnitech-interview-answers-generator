import { pkceCookieName } from "@omnitech/platform-integrations";
import { NextResponse } from "next/server";

import { resolvePlatformContext } from "@/src/platform/context";
import {
  ATTEMPT_SECONDS,
  callbackPath,
  integrationSecrets,
  providerFrom,
  startConnection,
} from "@/src/platform/integrations";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const provider = providerFrom((await params).provider);
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
  const secrets = integrationSecrets();
  if (!secrets) {
    return NextResponse.json(
      { error: "Integration secrets are not configured." },
      { status: 503 },
    );
  }
  const attempt = startConnection({
    provider,
    member: context,
    origin: requestUrl.origin,
    stateSecret: secrets.state,
  });
  if (!attempt) {
    return NextResponse.json(
      { error: `The ${provider} integration is not configured.` },
      { status: 503 },
    );
  }
  const response = NextResponse.redirect(attempt.url);
  if (attempt.verifier) {
    response.cookies.set(pkceCookieName(provider), attempt.verifier, {
      httpOnly: true,
      secure: requestUrl.protocol === "https:",
      sameSite: "lax",
      path: callbackPath(provider),
      maxAge: ATTEMPT_SECONDS,
    });
  }
  return response;
}
