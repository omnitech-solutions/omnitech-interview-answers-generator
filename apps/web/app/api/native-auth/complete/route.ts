import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  NATIVE_CALLBACK_URL,
  nativeHandoffs,
} from "@/src/platform/native-handoff";

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );

// The page the person's browser shows when sign-in is done: it hands control back
// to the Mac app. The button is the exact callback address, and the page also
// goes there by itself (a meta refresh: no script), so the browser asks "Open
// Interview Studio?" once and the app takes over.
//
// [SAFETY] The callback address holds a one-time code and nothing else; the page
// loads nothing from anywhere, runs no script, and is never cached or framed.
const donePage = (callback: string) => {
  const target = escapeHtml(callback);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="0;url=${target}">
<meta name="referrer" content="no-referrer">
<title>Signed in · Interview Studio</title>
<style>
html,body{margin:0;height:100%;background:#fff;color:#1f1f1f;font:14px -apple-system,BlinkMacSystemFont,"Geist",system-ui,sans-serif}
main{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:32px;text-align:center;box-sizing:border-box}
.mark{width:48px;height:48px;border-radius:14px;background:#5b8cff;color:#0b1430;display:flex;align-items:center;justify-content:center}
h1{margin:0;font-size:20px;font-weight:600}
p{margin:0;max-width:340px;color:#555;text-wrap:pretty}
a{display:inline-block;height:36px;line-height:36px;padding:0 16px;border-radius:9px;background:#1f1f1f;color:#fff;font-size:14px;font-weight:500;text-decoration:none}
</style>
</head>
<body>
<main>
<span class="mark" aria-hidden="true"><svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm16 5h1a2 2 0 0 1 2 2v9l-3-2h-7a2 2 0 0 1-2-2v-1h9a2 2 0 0 0 1-.3Z"/></svg></span>
<h1>You’re signed in</h1>
<p>Return to the Interview Studio app. You can close this tab.</p>
<a href="${target}">Open Interview Studio</a>
</main>
</body>
</html>`;
};

// Auth.js lands here after the provider, inside the person's browser. The
// callback address carries a one-time handoff code and nothing else: never the
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
  return new Response(
    donePage(`${NATIVE_CALLBACK_URL}?code=${encodeURIComponent(code)}`),
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-frame-options": "DENY",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    },
  );
}
