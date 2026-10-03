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
};

const DEFAULT_ARTIFACT = "main";

export type StudioNavigation = {
  view: ViewId;
  artifact?: string;
  rest?: readonly string[];
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
  const artifact =
    new URLSearchParams(location.search).get("artifact") ?? DEFAULT_ARTIFACT;
  return { base, view, rest: view === "home" ? [] : rest, artifact };
}

export function routeHref(
  route: Pick<StudioRoute, "base" | "view" | "artifact" | "rest">,
) {
  const path =
    route.view === "home"
      ? route.base || "/"
      : [route.base, route.view, ...route.rest.map(encodeURIComponent)].join(
          "/",
        );
  return route.view === "work" && route.artifact !== DEFAULT_ARTIFACT
    ? `${path}?artifact=${encodeURIComponent(route.artifact)}`
    : path;
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
      artifact: next.artifact ?? current.current.artifact,
    };
    const href = routeHref(target);
    if (`${window.location.pathname}${window.location.search}` !== href)
      window.history.pushState({}, "", href);
    setRoute(target);
  }, []);
  return { route, navigate };
}
