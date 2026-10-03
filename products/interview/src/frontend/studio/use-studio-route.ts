import { useCallback, useEffect, useRef, useState } from "react";

export const VIEW_IDS = [
  "home",
  "work",
  "briefings",
  "documents",
  "knowledge",
  "rehearsal",
  // The Active Session: setup, the live session and the ended summary are
  // states of this one view; `live/<sessionId>` addresses a finished session.
  "live",
] as const;
export type ViewId = (typeof VIEW_IDS)[number];

export type StudioRoute = {
  // The product root, e.g. "/t/local/p/interview".
  base: string;
  view: ViewId;
  // Path segments after the view, e.g. a Knowledge article slug.
  rest: readonly string[];
  artifact: string;
  // A session's private Workspace (`active-session:<sessionId>`), opened from
  // the Live session. The one bounded override of the Workspace id: the
  // Workspace otherwise always edits the product's own workspace.
  workspace?: string | undefined;
};

const DEFAULT_ARTIFACT = "main";
// The only Workspace ids the URL may name (live/session-drafts.ts writes them).
export const SESSION_WORKSPACE_PREFIX = "active-session:";

export type StudioNavigation = {
  view: ViewId;
  artifact?: string;
  rest?: readonly string[];
  // Only honoured for the Workspace and only for a session's Workspace id.
  workspace?: string | undefined;
};

export function parseRoute(location: { pathname: string; search: string }) {
  const base = /^\/t\/[^/]+\/p\/[^/]+/.exec(location.pathname)?.[0] ?? "";
  const [first = "", ...rest] = location.pathname
    .slice(base.length)
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  const view = (VIEW_IDS as readonly string[]).includes(first)
    ? (first as ViewId)
    : "home";
  const query = new URLSearchParams(location.search);
  const artifact = query.get("artifact") ?? DEFAULT_ARTIFACT;
  // [GUARD] An unlisted Workspace id in the URL is ignored, never opened.
  const workspace = query.get("workspace");
  return {
    base,
    view,
    rest: view === "home" ? [] : rest,
    artifact,
    ...(view === "work" && workspace?.startsWith(SESSION_WORKSPACE_PREFIX)
      ? { workspace }
      : {}),
  };
}

export function routeHref(
  route: Pick<StudioRoute, "base" | "view" | "artifact" | "rest"> &
    Partial<Pick<StudioRoute, "workspace">>,
) {
  const path =
    route.view === "home"
      ? route.base || "/"
      : [route.base, route.view, ...route.rest.map(encodeURIComponent)].join(
          "/",
        );
  if (route.view !== "work") return path;
  const query = [
    ...(route.artifact !== DEFAULT_ARTIFACT || route.workspace
      ? [`artifact=${encodeURIComponent(route.artifact)}`]
      : []),
    ...(route.workspace
      ? [`workspace=${encodeURIComponent(route.workspace)}`]
      : []),
  ].join("&");
  return query ? `${path}?${query}` : path;
}

// The studio's place lives in the URL, so reloads and back/forward work.
// Views own whatever follows their segment (Knowledge writes article paths).
export function useStudioRoute() {
  const [route, setRoute] = useState<StudioRoute>(() =>
    parseRoute(window.location),
  );
  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const current = useRef(route);
  current.current = route;
  const navigate = useCallback((next: StudioNavigation) => {
    const target = {
      ...current.current,
      view: next.view,
      rest: next.rest ?? [],
      // A session draft's artifact id means nothing in the product's own
      // workspace, so leaving the draft for "Workspace" opens the default.
      artifact:
        next.artifact ??
        (current.current.workspace
          ? DEFAULT_ARTIFACT
          : current.current.artifact),
      workspace: next.view === "work" ? next.workspace : undefined,
    };
    const href = routeHref(target);
    if (`${window.location.pathname}${window.location.search}` !== href)
      window.history.pushState({}, "", href);
    setRoute(target);
  }, []);
  return { route, navigate };
}
