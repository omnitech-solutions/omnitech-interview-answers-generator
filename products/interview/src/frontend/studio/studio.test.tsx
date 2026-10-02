import type { AssistantConfig } from "@omnitech-assistant/react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStudio } from "./context";
import { Studio } from "./studio";

// The assistant package, with a host the tests can observe and drive.
const host = vi.hoisted(() => ({
  config: undefined as unknown as AssistantConfig,
  state: {
    open: false,
    shortcut: "⌘J",
    toggle: (() => undefined) as () => void,
  },
}));
vi.mock("@omnitech-assistant/react", () => ({
  AssistantRoot: ({
    config,
    children,
  }: {
    config: AssistantConfig;
    children: React.ReactNode;
  }) => {
    host.config = config;
    return <div className="oa-root">{children}</div>;
  },
  useAssistantHost: () => host.state,
  Icon: () => <svg data-testid="assistant-icon" />,
}));

// Views are stand-ins: the shell's job is routing, binding and chrome.
const views = vi.hoisted(() => ({ throwLibrary: false }));
vi.mock("./workspace/workspace-view", () => ({
  WorkspaceView: ({ assistant }: { assistant: { artifactId: string } }) => {
    const studio = useStudio();
    const hooks = useRef({
      prepareSend: vi.fn(async () => ({
        workspaceId: "interview",
        artifactId: assistant.artifactId,
        artifactRevision: 7,
      })),
      onApplied: vi.fn(async () => undefined),
    });
    useEffect(
      () =>
        studio?.bindView({
          origin: {
            workspaceId: "interview",
            artifactId: assistant.artifactId,
            artifactRevision: 7,
          },
          hooks,
          runTests: () => {
            document.title = `ran ${assistant.artifactId}`;
          },
        }),
      [studio?.bindView, assistant.artifactId],
    );
    return <div>Workspace artifact: {assistant.artifactId}</div>;
  },
}));
vi.mock("../interview-preparation", () => ({
  InterviewPreparation: ({
    artifactId,
    onDirtyChange,
  }: {
    artifactId: string;
    onDirtyChange(dirty: boolean): void;
  }) => (
    <div>
      Preparation {artifactId}
      <button type="button" onClick={() => onDirtyChange(true)}>
        Edit preparation
      </button>
    </div>
  ),
}));
vi.mock("../library", () => ({
  Library: ({ basePath }: { basePath: string }) => {
    if (views.throwLibrary) throw new Error("library broke");
    return <div>Library at {basePath}</div>;
  },
}));
vi.mock("./rehearsal/rehearsal-view", () => ({
  RehearsalView: () => {
    const studio = useStudio();
    return (
      <div>
        Rehearsal session
        <button type="button" onClick={() => studio?.setFocus("live")}>
          Go live
        </button>
        <button type="button" onClick={() => studio?.setFocus("strict")}>
          Go strict
        </button>
        <button type="button" onClick={() => studio?.setFocus(null)}>
          Leave focus
        </button>
      </div>
    );
  },
}));

const questions = [
  {
    artifactId: "q1",
    title: "LRU cache with TTL eviction",
    kind: "coding",
    language: "typescript",
    revision: 2,
    updatedAt: new Date().toISOString(),
  },
  {
    artifactId: "b1",
    title: "Prep draft",
    kind: "briefing",
    language: null,
    revision: 1,
    updatedAt: new Date().toISOString(),
  },
  ...Array.from({ length: 7 }, (_, index) => ({
    artifactId: `extra-${index}`,
    title: `Extra question ${index}`,
    kind: "coding",
    language: null,
    revision: 0,
    updatedAt: new Date(Date.now() - 86_400_000 * 2).toISOString(),
  })),
];

let listFails = false;
function installServer() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const path = String(input);
      if (path.startsWith("/api/interview/workspaces/interview/artifacts"))
        return listFails
          ? new Response("{}", { status: 500 })
          : Response.json(questions);
      if (path.startsWith("/api/interview/briefing/artifacts"))
        return Response.json({
          artifacts: [
            {
              id: "pack-1",
              title: "Northwind recruiter screen",
              revision: 1,
              savedRevision: 1,
              updatedAt: new Date().toISOString(),
            },
          ],
        });
      return Response.json({});
    }),
  );
}

const assistant = {
  client: {} as never,
  workspaceId: "interview",
  profileId: "local-interview",
};
const key = (key: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(window, { key, ...init });

async function renderStudio(path = "/t/local/p/interview") {
  window.history.replaceState({}, "", path);
  render(<Studio assistant={assistant} />);
  await screen.findAllByText("LRU cache with TTL eviction");
}

beforeEach(() => {
  vi.unstubAllGlobals();
  listFails = false;
  views.throwLibrary = false;
  host.state = { open: false, shortcut: "⌘J", toggle: vi.fn() };
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => values.set(name, value),
      removeItem: (name: string) => values.delete(name),
    },
  });
  installServer();
});

describe("Studio shell", () => {
  it("opens on Home with this person's coding questions", async () => {
    await renderStudio();
    expect(screen.getByRole("banner")).toHaveTextContent("Home");
    const recent = screen.getAllByTitle(/question|LRU/i, {
      exact: false,
    });
    expect(recent.length).toBeGreaterThan(0);
    // Briefing drafts are not coding questions; the sidebar shows six.
    expect(screen.queryByText("Prep draft")).toBeNull();
    const sidebar = screen.getByRole("complementary", { name: "Studio" });
    expect(
      within(sidebar).getAllByRole("button", { name: /LRU|Extra/ }),
    ).toHaveLength(6);
    expect(screen.getByText("TypeScript")).toBeVisible();
  });

  it("puts each view in the URL and follows back and forward", async () => {
    await renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /Knowledge/ }));
    expect(window.location.pathname).toBe("/t/local/p/interview/knowledge");
    expect(
      screen.getByText("Library at /t/local/p/interview/knowledge"),
    ).toBeVisible();
    expect(screen.getByText("sees: search results")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Rehearsal/ }));
    expect(screen.getByText("Rehearsal session")).toBeVisible();
    act(() => {
      window.history.replaceState({}, "", "/t/local/p/interview/knowledge");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByText(/Library at/)).toBeVisible();
  });

  it("opens a recent question in the Workspace", async () => {
    await renderStudio();
    const sidebar = screen.getByRole("complementary", { name: "Studio" });
    fireEvent.click(
      within(sidebar).getByRole("button", {
        name: "LRU cache with TTL eviction",
      }),
    );
    expect(screen.getByText("Workspace artifact: q1")).toBeVisible();
    expect(window.location.search).toBe("?artifact=q1");
    expect(
      within(sidebar).getByRole("button", {
        name: "LRU cache with TTL eviction",
      }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("runs palette commands from the keyboard", async () => {
    await renderStudio();
    key("k", { metaKey: true });
    const search = screen.getByRole("combobox", {
      name: "Search questions, briefings, or type a command",
    });
    expect(search).toHaveFocus();
    // Questions and saved briefings are listed alongside commands.
    expect(screen.getByRole("option", { name: /Northwind/ })).toBeVisible();
    fireEvent.change(search, { target: { value: "work" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "ArrowUp" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Workspace artifact: main")).toBeVisible();

    key("k", { ctrlKey: true });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No matches")).toBeVisible();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a saved briefing from the palette", async () => {
    await renderStudio();
    fireEvent.click(screen.getByRole("button", { name: /Search or jump/ }));
    fireEvent.click(screen.getByRole("option", { name: /Northwind/ }));
    expect(window.location.pathname).toBe(
      "/t/local/p/interview/briefings/pack-1",
    );
    expect(screen.getByText("Preparation pack-1")).toBeVisible();
  });

  it("follows G sequences, but not while typing", async () => {
    await renderStudio();
    key("g");
    key("b");
    expect(screen.getByText("What do you need to explain?")).toBeVisible();
    const field = document.createElement("textarea");
    document.body.append(field);
    fireEvent.keyDown(field, { key: "g" });
    fireEvent.keyDown(field, { key: "h" });
    expect(screen.getByText("What do you need to explain?")).toBeVisible();
    field.remove();
    key("g");
    key("x");
    key("h");
    expect(screen.getByText("What do you need to explain?")).toBeVisible();
  });

  it("starts a new question with N", async () => {
    await renderStudio();
    key("n");
    expect(window.location.search).toMatch(/^\?artifact=q-/);
    expect(screen.getByText(/Workspace artifact: q-/)).toBeVisible();
  });

  it("lets the open Workspace lend its draft, hooks and tests to the shell", async () => {
    await renderStudio("/t/local/p/interview/work?artifact=q1");
    await waitFor(() =>
      expect(host.config.origin).toMatchObject({ artifactRevision: 7 }),
    );
    key("Enter", { metaKey: true });
    expect(document.title).toBe("ran q1");
    await expect(host.config.host!.prepareSend!()).resolves.toMatchObject({
      artifactId: "q1",
    });
    await act(() =>
      host.config.host!.onApplied!({} as never, host.config.origin),
    );
    // ⌘↵ only exists in the Workspace.
    fireEvent.click(screen.getByRole("button", { name: /Home/ }));
    document.title = "";
    key("Enter", { metaKey: true });
    expect(document.title).toBe("");
    // Without a bound view the assistant uses the shell's own origin.
    await expect(host.config.host!.prepareSend!()).resolves.toMatchObject({
      artifactId: "q1",
      artifactRevision: 0,
    });
  });

  it("toggles the docked assistant and opens threads it points at", async () => {
    await renderStudio();
    fireEvent.click(screen.getByRole("button", { name: "Assistant" }));
    expect(host.state.toggle).toHaveBeenCalledTimes(1);
    key("k", { metaKey: true });
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "assistant" },
    });
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Enter" });
    expect(host.state.toggle).toHaveBeenCalledTimes(2);
    // ⌘J belongs to the assistant package; the shell does not bind it too.
    key("j", { metaKey: true });
    expect(host.state.toggle).toHaveBeenCalledTimes(2);
    expect(host.config.shortcuts).toEqual({ search: "mod+shift+k" });
    act(() =>
      host.config.host!.onOpenBinding!({
        workspaceId: "interview",
        artifactId: "q1",
      }),
    );
    expect(screen.getByText("Workspace artifact: q1")).toBeVisible();
    act(() =>
      host.config.host!.onOpenBinding!({
        workspaceId: "elsewhere",
        artifactId: "x",
      }),
    );
    expect(screen.getByText("Workspace artifact: q1")).toBeVisible();
  });

  it("keeps one theme for the shell, its views and the assistant", async () => {
    await renderStudio();
    expect(host.config.theme).toBe("light");
    fireEvent.click(screen.getByRole("button", { name: "Use dark theme" }));
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(window.localStorage.getItem("interview-playground.theme")).toBe(
      "dark",
    );
    expect(host.config.theme).toBe("dark");
    act(() => host.config.host!.onThemeChange!("light"));
    expect(host.config.theme).toBe("light");
    act(() => host.config.host!.onThemeChange!("light"));
    expect(host.config.theme).toBe("light");
  });

  it("asks before leaving unsaved interview preparation", async () => {
    await renderStudio("/t/local/p/interview/briefings/preparation");
    fireEvent.click(screen.getByRole("button", { name: "Edit preparation" }));
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: /Home/ }));
    expect(screen.getByText("Preparation preparation")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Home/ }));
    expect(screen.getByRole("banner")).toHaveTextContent("Home");
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });

  it("shows a retry when questions fail to load", async () => {
    listFails = true;
    window.history.replaceState({}, "", "/t/local/p/interview");
    render(<Studio assistant={assistant} />);
    const sidebar = await screen.findByRole("complementary", {
      name: "Studio",
    });
    await within(sidebar).findByText("Couldn’t load questions.");
    listFails = false;
    fireEvent.click(within(sidebar).getByRole("button", { name: "Retry" }));
    await within(sidebar).findByText("LRU cache with TTL eviction");
  });

  it("contains a crashing view and can reload it", async () => {
    views.throwLibrary = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await renderStudio("/t/local/p/interview/knowledge");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This view hit an error.",
    );
    // The rest of the studio still works.
    expect(screen.getByRole("button", { name: /Home/ })).toBeEnabled();
    views.throwLibrary = false;
    fireEvent.click(screen.getByRole("button", { name: "Reload view" }));
    expect(screen.getByText(/Library at/)).toBeVisible();
  });

  it("steps the sidebar aside for a live rehearsal and keeps strict mode assistant-free", async () => {
    host.state = { ...host.state, open: true };
    await renderStudio("/t/local/p/interview/rehearsal");
    // A live session closes the open assistant once, and hides the sidebar.
    fireEvent.click(screen.getByRole("button", { name: "Go live" }));
    expect(host.state.toggle).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Knowledge/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Assistant/ })).toBeVisible();
    // Strict mode hides the toggle and keeps closing the assistant.
    fireEvent.click(screen.getByRole("button", { name: "Go strict" }));
    expect(screen.queryByRole("button", { name: /^Assistant/ })).toBeNull();
    expect(host.state.toggle).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Leave focus" }));
    expect(screen.getByRole("button", { name: /Knowledge/ })).toBeVisible();
  });

  it("resizes the assistant dock by dragging or with the keyboard, and remembers it", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1600,
    });
    host.state = { ...host.state, open: true };
    await renderStudio();
    const handle = screen.getByRole("separator", { name: "Resize assistant" });
    expect(host.config.layout?.width).toBe(400);
    expect(handle).toHaveAttribute("aria-valuenow", "400");

    // Dragging left widens the dock; it never squeezes the main view below 480px.
    fireEvent.pointerDown(handle, { clientX: 1200, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 1000, pointerId: 1 });
    expect(host.config.layout?.width).toBe(600);
    fireEvent.pointerMove(handle, { clientX: 100, pointerId: 1 });
    expect(host.config.layout?.width).toBe(1600 - 480);
    fireEvent.pointerUp(handle, { pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 1300, pointerId: 1 });
    expect(host.config.layout?.width).toBe(1600 - 480);
    expect(
      window.localStorage.getItem("interview-studio.assistant-width"),
    ).toBe(String(1600 - 480));

    fireEvent.keyDown(handle, { key: "Home" });
    expect(host.config.layout?.width).toBe(320);
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(host.config.layout?.width).toBe(336);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(host.config.layout?.width).toBe(320);
    fireEvent.keyDown(handle, { key: "End" });
    expect(host.config.layout?.width).toBe(1600 - 480);
    fireEvent.doubleClick(handle);
    expect(host.config.layout?.width).toBe(400);
  });

  it("starts from the remembered dock width and hides the handle while closed", async () => {
    window.localStorage.setItem("interview-studio.assistant-width", "520");
    await renderStudio();
    expect(host.config.layout?.width).toBe(520);
    expect(screen.queryByRole("separator")).toBeNull();
  });

  it("uses an icon rail when the window is narrow", async () => {
    const width = window.innerWidth;
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 800,
    });
    await renderStudio();
    expect(document.querySelector(".studio-frame")).toHaveClass("rail");
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1600,
    });
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(document.querySelector(".studio-frame")).not.toHaveClass("rail");
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: width,
    });
  });
});
