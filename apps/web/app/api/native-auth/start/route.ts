import { NextResponse } from "next/server";

import { signIn } from "@/auth";
import {
  configuredLoginProviders,
  isAttemptState,
  nativeHandoffs,
} from "@/src/platform/native-handoff";

// The shell opens this in a system web-auth session with its own attempt nonce.
// It registers the attempt and starts Studio's ordinary Auth.js sign-in; the
// provider pages run in that session, never in the shell's web view.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  if (!isAttemptState(state))
    return NextResponse.json(
      { error: "The sign-in attempt is invalid." },
      { status: 400 },
    );
  const configured = configuredLoginProviders();
  const requested = url.searchParams.get("provider");
  const provider =
    configured.find((candidate) => candidate === requested) ?? configured[0];
  if (!provider)
    return NextResponse.json(
      { error: "No login provider is configured." },
      { status: 503 },
    );
  nativeHandoffs().beginAttempt(state);
  // Auth.js answers with a redirect to the provider.
  return await signIn(provider, {
    redirectTo: `/api/native-auth/complete?state=${state}`,
  });
}
