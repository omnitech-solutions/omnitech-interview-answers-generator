import { NextResponse } from "next/server";

import { signIn } from "@/auth";
import { localSignInNeeded } from "@/src/platform/fake-auth";
import {
  configuredLoginProviders,
  isAttemptState,
  isChallenge,
  nativeHandoffs,
} from "@/src/platform/native-handoff";

// The shell opens this in a system web-auth session with its own attempt nonce.
// It registers the attempt and starts Studio's ordinary Auth.js sign-in; the
// provider pages run in that session, never in the shell's web view.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const challenge = url.searchParams.get("challenge");
  if (!isAttemptState(state) || !isChallenge(challenge))
    return NextResponse.json(
      { error: "The sign-in attempt is invalid." },
      { status: 400 },
    );
  // Real providers first; the local sign-in only where there is no bypass.
  const configured: string[] = [
    ...configuredLoginProviders(),
    ...(localSignInNeeded() ? ["local"] : []),
  ];
  const requested = url.searchParams.get("provider");
  const provider =
    configured.find((candidate) => candidate === requested) ?? configured[0];
  if (!provider)
    return NextResponse.json(
      { error: "No login provider is configured." },
      { status: 503 },
    );
  nativeHandoffs().beginAttempt(state, challenge);
  // Auth.js answers with a redirect to the provider.
  return await signIn(provider, {
    redirectTo: `/api/native-auth/complete?state=${state}`,
  });
}
