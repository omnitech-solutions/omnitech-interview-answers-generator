import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";

import { authSecret, sessionCookieName } from "@/auth";
import { isTenantSlug, nativeHandoffs } from "@/src/platform/native-handoff";

const SESSION_SECONDS = 30 * 24 * 60 * 60;

// The shell loads this inside its web view with the handoff code and its attempt
// nonce. A valid, unspent code sets Studio's own session cookie there and sends
// the person to the overlay; anything else is refused with no detail.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const identity = nativeHandoffs().consume(
    url.searchParams.get("code") ?? "",
    url.searchParams.get("state") ?? "",
    url.origin,
  );
  if (!identity || !authSecret)
    return NextResponse.json(
      { error: "The sign-in handoff is invalid or expired." },
      {
        status: 403,
        headers: {
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      },
    );
  const secure = url.protocol === "https:";
  const name = sessionCookieName(secure);
  const token = await encode({
    token: {
      email: identity.email,
      name: identity.name,
      picture: identity.image,
      sub: identity.email,
    },
    secret: authSecret,
    salt: name,
    maxAge: SESSION_SECONDS,
  });
  const tenant = url.searchParams.get("tenant");
  const slug = isTenantSlug(tenant) ? tenant : "local";
  const response = new NextResponse(null, {
    status: 302,
    headers: {
      // Relative: the web view stays on the host it called (see the test).
      location: `/t/${slug}/p/interview/live/overlay?host=native`,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
  response.cookies.set(name, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: SESSION_SECONDS,
  });
  return response;
}
