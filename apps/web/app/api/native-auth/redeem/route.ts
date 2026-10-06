import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";

import { authSecret, sessionCookieName } from "@/auth";
import { isTenantSlug, nativeHandoffs } from "@/src/platform/native-handoff";

const SESSION_SECONDS = 30 * 24 * 60 * 60;

// The shell loads this inside its web view with the handoff code and its attempt
// nonce. A valid, unspent code sets Studio's own session cookie there and sends
// the person to the overlay; anything else is refused with no detail.
// [SAFETY] Whether the session cookie is Secure (and so named `__Secure-...`),
// decided the way Auth.js decides it when it reads the cookie back: the
// protocol of AUTH_URL when set, else the forwarded protocol, else the
// request's own. Behind a TLS-terminating proxy the request URL is http, and a
// cookie set as plain there is never found by Auth.js over https (verified by
// experiment): the person would be silently signed out.
function secureCookies(request: Request, url: URL): boolean {
  const configured = process.env["AUTH_URL"] ?? process.env["NEXTAUTH_URL"];
  if (configured) {
    try {
      return new URL(configured).protocol === "https:";
    } catch {
      // An unusable AUTH_URL is not this route's business; fall through.
    }
  }
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]?.trim() === "https";
  return url.protocol === "https:";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const identity = nativeHandoffs().consume(
    url.searchParams.get("code") ?? "",
    url.searchParams.get("state") ?? "",
    url.searchParams.get("verifier") ?? "",
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
  const secure = secureCookies(request, url);
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
      // Relative: the web view stays on the host it called (see the test). The
      // compact panel the shell loads itself, never the bare card.
      location: `/t/${slug}/p/interview/live/overlay?host=native&panel=single&handsfree=1`,
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
