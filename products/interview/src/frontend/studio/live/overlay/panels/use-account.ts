// The native window's account side: the shell's `account` bridge (sign-in in the
// person's default browser, sign-out, the Mac's permissions), Studio's public
// list of what can sign in, and the local profile's sign-in done inside this web
// view. Every read is defensive: a shell without the bridge, or a Studio that
// does not answer, leaves the screens saying so instead of offering a dead button.
//
// [SAFETY] Nothing here holds an address, code, nonce or token: the shell keeps
// the sign-in link to itself, and the local sign-in is Studio's own Auth.js form
// post with its own CSRF token, same origin, in the page that asked for it.
import type {
  AccountHost,
  AccountPermissions,
  AccountSignInState,
} from "@omnitech/interview-contracts";
import { useCallback, useEffect, useState } from "react";
import { studioHostInfo } from "../../host-adapter";

// The bridge's account object, or null (a browser, an older shell).
export function accountHost(): AccountHost | null {
  const info = studioHostInfo();
  return info?.capabilities.has("account") ? (info.host.account ?? null) : null;
}

const IDLE: AccountSignInState = { phase: "idle" };

// What the shell last said about the sign-in; re-renders on each event. The
// snapshot is kept by value so React sees one object per change.
export function useSignInState(host: AccountHost | null): AccountSignInState {
  const [state, setState] = useState<AccountSignInState>(
    () => host?.state() ?? IDLE,
  );
  useEffect(() => {
    if (!host) return;
    setState(host.state());
    return host.onState(setState);
  }, [host]);
  return host ? state : IDLE;
}

// Which sign-ins Studio offers here, from its public providers route.
export type Providers =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      google: boolean;
      linkedin: boolean;
      local: boolean;
    };

// [GUARD] `providers` is the list (google, linkedin, local); the older shape
// (`configured` only) means "a real provider exists", so both are offered.
export function parseProviders(body: unknown): Providers {
  if (typeof body !== "object" || body === null) return { status: "error" };
  const { providers, configured } = body as {
    providers?: unknown;
    configured?: unknown;
  };
  if (Array.isArray(providers)) {
    const names = providers.filter(
      (name): name is string => typeof name === "string",
    );
    return {
      status: "ready",
      google: names.includes("google"),
      linkedin: names.includes("linkedin"),
      local: names.includes("local"),
    };
  }
  if (typeof configured !== "boolean") return { status: "error" };
  return {
    status: "ready",
    google: configured,
    linkedin: configured,
    local: false,
  };
}

export function useProviders(): { providers: Providers; retry(): void } {
  const [providers, setProviders] = useState<Providers>({ status: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    // `round` restarts the read for "Try again".
    void round;
    let live = true;
    setProviders({ status: "loading" });
    fetch("/api/native-auth/providers", { credentials: "same-origin" })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error("status")),
      )
      .then(
        (body) => live && setProviders(parseProviders(body)),
        () => live && setProviders({ status: "error" }),
      );
    return () => {
      live = false;
    };
  }, [round]);
  return { providers, retry: useCallback(() => setRound((n) => n + 1), []) };
}

// The Mac's permission states, read now and again every few seconds and when
// the window comes back to the front (the person changes them in System
// Settings and returns). null: no bridge, or not yet answered.
const PERMISSION_POLL_MS = 2_500;

export function usePermissions(
  host: AccountHost | null,
  active: boolean,
): AccountPermissions | null {
  const [permissions, setPermissions] = useState<AccountPermissions | null>(
    null,
  );
  useEffect(() => {
    if (!host || !active) return;
    let live = true;
    const read = () =>
      host.permissions().then(
        (next) => live && setPermissions(next),
        () => undefined,
      );
    void read();
    const timer = setInterval(() => void read(), PERMISSION_POLL_MS);
    window.addEventListener("focus", read);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, [host, active]);
  return permissions;
}

const TENANT_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

// The workspace this window belongs to: from /t/<slug>/... on a tenant route,
// from `?tenant=` on the public sign-in route (what the shell passes), else the
// default workspace.
export function windowTenant(location: Location = window.location): string {
  const fromPath = /^\/t\/([^/]+)/.exec(location.pathname)?.[1];
  const named = fromPath
    ? decodeURIComponent(fromPath)
    : new URLSearchParams(location.search).get("tenant");
  return named && TENANT_SLUG.test(named) ? named : "local";
}

// The one way this window leaves for another address (a test replaces it).
export const navigation = {
  assign(url: string): void {
    window.location.assign(url);
  },
};

// Where the shell's window goes once someone is signed in: the compact panel.
export const panelAddress = (tenant: string): string =>
  `/t/${tenant}/p/interview/live/overlay?host=native&panel=single&handsfree=1`;

// The local profile signs in HERE, in this web view, through Studio's own
// Auth.js form post (no browser, no handoff code). True once Studio reports a
// session for it; the caller then goes to the panel.
export async function signInLocal(
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const csrf = await fetcher("/api/auth/csrf", {
      credentials: "same-origin",
    });
    if (!csrf.ok) return false;
    const { csrfToken } = (await csrf.json()) as { csrfToken?: unknown };
    if (typeof csrfToken !== "string" || csrfToken === "") return false;
    await fetcher("/api/auth/callback/local", {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, callbackUrl: "/" }).toString(),
    });
    const session = await fetcher("/api/auth/session", {
      credentials: "same-origin",
    });
    if (!session.ok) return false;
    const body = (await session.json()) as { user?: unknown } | null;
    return typeof body === "object" && body !== null && Boolean(body.user);
  } catch {
    return false;
  }
}

// A one-time "just signed in" mark that survives the redirect after sign-in
// (same web view, same tab), so the idle screen welcomes the person once.
const WELCOME_KEY = "studio.native.welcome";
export function markWelcome(): void {
  try {
    window.sessionStorage.setItem(WELCOME_KEY, "1");
  } catch {
    // The welcome is only a courtesy.
  }
}
export function takeWelcome(): boolean {
  try {
    const marked = window.sessionStorage.getItem(WELCOME_KEY) === "1";
    window.sessionStorage.removeItem(WELCOME_KEY);
    return marked;
  } catch {
    return false;
  }
}
