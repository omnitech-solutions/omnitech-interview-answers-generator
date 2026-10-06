// Ending this browser's sign-in with Auth.js's own endpoints: a same-origin
// CSRF token, then a POST to /api/auth/signout. The session is a stateless
// token, so this ends THIS browser's session only; nothing is revoked for
// other devices, and the page says so.
export type SignOutResult = { ok: true } | { ok: false };

export async function signOutOfBrowser(
  fetcher: typeof fetch = fetch,
): Promise<SignOutResult> {
  try {
    const csrf = await fetcher("/api/auth/csrf", {
      credentials: "same-origin",
    });
    if (!csrf.ok) return { ok: false };
    const { csrfToken } = (await csrf.json()) as { csrfToken?: string };
    if (!csrfToken) return { ok: false };
    const response = await fetcher("/api/auth/signout", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-auth-return-redirect": "1",
      },
      body: new URLSearchParams({ csrfToken, callbackUrl: "/signed-out" }),
    });
    return response.ok ? { ok: true } : { ok: false };
  } catch {
    return { ok: false };
  }
}

// Where the person lands once signed out; the page tells a local user their
// data is still there.
export const signedOutPath = (kind: "account" | "local") =>
  kind === "local" ? "/signed-out?as=local" : "/signed-out";
