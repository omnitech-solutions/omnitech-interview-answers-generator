import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseRoute, routeHref, useStudioRoute } from "./use-studio-route";

const BASE = "/t/local/p/interview";
const WORKSPACE = "active-session:0b1f6a52-7c7e-4f0e-9e1b-2c3d4e5f6a7b";

afterEach(() => window.history.replaceState({}, "", "/"));

describe("a session draft in the studio route", () => {
  it("round-trips the session's Workspace id and artifact", () => {
    const href = routeHref({
      base: BASE,
      view: "work",
      rest: [],
      artifact: "coding:task-1",
      workspace: WORKSPACE,
    });
    expect(href).toBe(
      `${BASE}/work?artifact=coding%3Atask-1&workspace=${encodeURIComponent(WORKSPACE)}`,
    );
    const url = new URL(href, "http://studio.test");
    expect(parseRoute(url)).toEqual({
      base: BASE,
      view: "work",
      rest: [],
      artifact: "coding:task-1",
      workspace: WORKSPACE,
    });
  });

  it("names an artifact even when it is the default one", () => {
    expect(
      routeHref({
        base: BASE,
        view: "work",
        rest: [],
        artifact: "main",
        workspace: WORKSPACE,
      }),
    ).toContain("artifact=main&workspace=");
  });

  it("accepts only a session Workspace id, and only for the Workspace", () => {
    const query = (workspace: string) =>
      parseRoute({
        pathname: `${BASE}/work`,
        search: `?artifact=q1&workspace=${encodeURIComponent(workspace)}`,
      });
    // [GUARD] The URL cannot point the editor at any other workspace id.
    expect(query("briefings").workspace).toBeUndefined();
    expect(query("interview").workspace).toBeUndefined();
    expect(query(WORKSPACE).workspace).toBe(WORKSPACE);
    expect(
      parseRoute({
        pathname: `${BASE}/rehearsal`,
        search: `?workspace=${encodeURIComponent(WORKSPACE)}`,
      }).workspace,
    ).toBeUndefined();
  });

  it("opens the session draft and leaves it without carrying its artifact", () => {
    window.history.replaceState({}, "", `${BASE}/live`);
    const { result } = renderHook(() => useStudioRoute());
    act(() =>
      result.current.navigate({
        view: "work",
        artifact: "coding:task-1",
        workspace: WORKSPACE,
      }),
    );
    expect(result.current.route).toMatchObject({
      view: "work",
      artifact: "coding:task-1",
      workspace: WORKSPACE,
    });
    expect(window.location.search).toContain("workspace=");

    // [GUARD] "Workspace" in the sidebar must not open coding:task-1 in the
    // product's own workspace (it would start a stray question there).
    act(() => result.current.navigate({ view: "work" }));
    expect(result.current.route.artifact).toBe("main");
    expect(result.current.route.workspace).toBeUndefined();
    expect(window.location.search).toBe("");
  });
});
