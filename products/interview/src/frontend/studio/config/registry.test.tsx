import { describe, expect, it, vi } from "vitest";
import { formatShortcut, parseShortcut } from "../use-shortcuts";
import { parseRoute, routeHref, VIEW_IDS } from "../use-studio-route";
import { available, commands, type StudioActions } from "./commands";
import { views } from "./views";

vi.mock("../workspace/workspace-view", () => ({ WorkspaceView: () => null }));
vi.mock("../../interview-preparation", () => ({
  InterviewPreparation: () => null,
}));
vi.mock("../../library", () => ({ Library: () => null }));
vi.mock("../rehearsal/rehearsal-view", () => ({ RehearsalView: () => null }));

describe("view registry", () => {
  it("has one entry per routable view with unique ids and G keys", () => {
    expect(views.map((view) => view.id).sort()).toEqual([...VIEW_IDS].sort());
    expect(new Set(views.map((view) => view.goKey)).size).toBe(views.length);
    for (const view of views) {
      expect(view.label).toBeTruthy();
      expect(view.assistantContext).toBeTruthy();
    }
  });
});

describe("command registry", () => {
  it("has unique ids and parseable shortcuts", () => {
    expect(new Set(commands.map((command) => command.id)).size).toBe(
      commands.length,
    );
    for (const command of commands)
      if (command.shortcut)
        expect(() => parseShortcut(command.shortcut!)).not.toThrow();
  });

  it("hides commands that do not apply to the current view", () => {
    const ids = (view: (typeof VIEW_IDS)[number]) =>
      available({ view }).map((command) => command.id);
    expect(ids("work")).toContain("run-tests");
    expect(ids("home")).not.toContain("run-tests");
  });

  it("changes the studio only through StudioActions", () => {
    const actions: StudioActions = {
      go: vi.fn(),
      openArtifact: vi.fn(),
      openBriefing: vi.fn(),
      openBrief: vi.fn(),
      newQuestion: vi.fn(),
      runTests: vi.fn(),
      toggleTheme: vi.fn(),
      toggleAssistant: vi.fn(),
    };
    for (const command of commands) command.run(actions);
    expect(actions.go).toHaveBeenCalledTimes(views.length + 1);
    expect(actions.newQuestion).toHaveBeenCalledOnce();
    expect(actions.runTests).toHaveBeenCalledOnce();
    expect(actions.toggleTheme).toHaveBeenCalledOnce();
    expect(actions.toggleAssistant).toHaveBeenCalledOnce();
  });
});

describe("shortcuts", () => {
  it("parses modifiers and sequences, and rejects unknown modifiers", () => {
    expect(parseShortcut("mod+shift+k")).toEqual([
      { mod: true, shift: true, key: "k" },
    ]);
    expect(parseShortcut("g w")).toHaveLength(2);
    expect(() => parseShortcut("alt+k")).toThrow("Unsupported shortcut");
  });

  it("labels shortcuts for the platform", () => {
    expect(formatShortcut("g w")).toBe("G W");
    expect(formatShortcut("mod+enter")).toMatch(/^(⌘|Ctrl\+)↵$/);
  });
});

describe("studio route", () => {
  it("reads the view, the rest of the path and the artifact", () => {
    expect(
      parseRoute({
        pathname: "/t/local/p/interview/knowledge/react-effects",
        search: "?q=effects",
      }),
    ).toEqual({
      base: "/t/local/p/interview",
      view: "knowledge",
      rest: ["react-effects"],
      artifact: "main",
    });
    expect(
      parseRoute({ pathname: "/t/local/p/interview/unknown", search: "" }).view,
    ).toBe("home");
    expect(parseRoute({ pathname: "/", search: "?artifact=q1" })).toMatchObject(
      { base: "", view: "home", artifact: "q1" },
    );
  });

  it("writes the artifact only for the Workspace", () => {
    const base = "/t/local/p/interview";
    expect(routeHref({ base, view: "home", rest: [], artifact: "q1" })).toBe(
      base,
    );
    expect(
      routeHref({ base: "", view: "home", rest: [], artifact: "main" }),
    ).toBe("/");
    expect(routeHref({ base, view: "work", rest: [], artifact: "q 1" })).toBe(
      `${base}/work?artifact=q%201`,
    );
    expect(routeHref({ base, view: "work", rest: [], artifact: "main" })).toBe(
      `${base}/work`,
    );
    expect(
      routeHref({ base, view: "briefings", rest: ["pack 1"], artifact: "q1" }),
    ).toBe(`${base}/briefings/pack%201`);
  });
});
