import { NextResponse } from "next/server";

import { localSignInNeeded } from "@/src/platform/fake-auth";
import { configuredLoginProviders } from "@/src/platform/native-handoff";

// Public and credential-free: tells the native shell whether signing in is
// possible (a real login provider, or the local sign-in of a production build
// that has no development bypass), so it prompts "Sign in" only then.
export function GET() {
  return NextResponse.json(
    {
      configured: configuredLoginProviders().length > 0 || localSignInNeeded(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
