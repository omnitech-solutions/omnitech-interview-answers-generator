import { NextResponse } from "next/server";

import { configuredLoginProviders } from "@/src/platform/native-handoff";

// Public and credential-free: tells the native shell whether Studio has a real
// login provider at all, so it prompts "Sign in" only when signing in is possible.
export function GET() {
  return NextResponse.json(
    { configured: configuredLoginProviders().length > 0 },
    { headers: { "cache-control": "no-store" } },
  );
}
