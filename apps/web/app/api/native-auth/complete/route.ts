import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  NATIVE_CALLBACK_URL,
  nativeHandoffs,
} from "@/src/platform/native-handoff";

// Auth.js lands here after the provider, inside the web-auth session. The
// callback URL carries a one-time handoff code and nothing else: never the
// session token, and no provider token.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const session = await auth();
  const email = session?.user?.email;
  const code = email
    ? nativeHandoffs().issue(url.searchParams.get("state") ?? "", url.origin, {
        email,
        name: session.user?.name ?? null,
        image: session.user?.image ?? null,
      })
    : null;
  if (!code)
    return NextResponse.json(
      { error: "The sign-in could not be completed." },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  return new Response(null, {
    status: 302,
    headers: {
      location: `${NATIVE_CALLBACK_URL}?code=${encodeURIComponent(code)}`,
      "cache-control": "no-store",
    },
  });
}
