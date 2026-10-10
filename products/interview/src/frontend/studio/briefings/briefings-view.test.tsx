import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioActions } from "../config/commands";
import { PracticeTimer } from "../practice-timer";
import type { StudioLists } from "../use-studio-lists";
import { BriefingsView, selectionOf } from "./briefings-view";

vi.mock("./behavioural/behavioural-pack", () => ({
  BehaviouralPack: ({
    artifactId,
    autoDraft,
    onCreated,
  }: {
    artifactId: string | null;
    autoDraft?: boolean;
    onCreated(id: string): void;
  }) =>
    artifactId ? (
      <div>
        Preparation pack {artifactId}
        {autoDraft ? " (drafting)" : ""}
      </div>
    ) : (
      <button type="button" onClick={() => onCreated("prep-new")}>
        Create pack
      </button>
    ),
}));

const brief = {
  id: "b1",
  kind: "concept",
  topic: "How does React re-render?",
  title: "How does React re-render?",
  updatedAt: new Date().toISOString(),
  brief: {
    version: 1,
    headline: "React re-renders on **state**, a parent, or context.",
    points: [
      { heading: "**Triggers**", body: "State, parents, context." },
      { heading: "Reconciliation", body: "React diffs the tree." },
      { heading: "Avoiding work", body: "Memoise or move state." },
    ],
    example: "A search box and a big table.",
    pitfall: "Only when props change.",
    followUps: [
      { question: "What does memo compare?", answer: "Props, shallowly." },
      { question: "When use useTransition?", answer: "For slow updates." },
    ],
  },
};
let calls: { method: string; path: string; body?: unknown }[];
let buildStatus = 200;
function installServer() {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({
        method,
        path: input,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      if (input === "/api/interview/briefs" && method === "POST")
        return buildStatus === 200
          ? Response.json(brief)
          : Response.json(
              { error: { code: "generation-failed" } },
              { status: buildStatus },
            );
      if (input === "/api/interview/briefs/b1" && method === "DELETE")
        return Response.json({ ok: true });
      if (input === "/api/interview/briefs/b1") return Response.json(brief);
      return Response.json({ error: { code: "not-found" } }, { status: 404 });
    }),
  );
}

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
const lists: StudioLists = {
  status: "ready",
  refresh: vi.fn(),
  questions: [],
  briefings: [
    {
      id: "pack-1",
      title: "Northwind recruiter screen",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  ],
  briefs: [
    {
      id: "b1",
      kind: "concept",
      topic: "How does React re-render?",
      title: "How does React re-render?",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  ],
};
const view = (rest: string[]) =>
  render(
    <BriefingsView
      rest={rest}
      actions={actions}
      lists={lists}
      onDirtyChange={() => undefined}
    />,
  );

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  buildStatus = 200;
  installServer();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Briefings", () => {
  it("lists briefs and packs together, newest first", () => {
    view([]);
    const items = within(
      screen.getByRole("complementary", { name: "Briefings" }),
    ).getAllByRole("button", { name: /React|Northwind/ });
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("Concept"),
      expect.stringContaining("Behavioural · STAR"),
    ]);
    fireEvent.click(items[0]!);
    expect(actions.openBrief).toHaveBeenCalledWith("b1");
    fireEvent.click(items[1]!);
    expect(actions.openBriefing).toHaveBeenCalledWith("pack-1");
    fireEvent.click(screen.getByRole("button", { name: "New briefing" }));
    expect(actions.go).toHaveBeenCalledWith("briefings");
  });

  it("builds a brief of the chosen kind and opens it", async () => {
    view([]);
    fireEvent.click(screen.getByRole("radio", { name: "System design" }));
    expect(screen.getByLabelText("Topic")).toHaveAttribute(
      "placeholder",
      "e.g. Design a URL shortener",
    );
    const build = screen.getByRole("button", { name: "Build briefing" });
    expect(build).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Topic"), {
      target: { value: "Design a cache layer" },
    });
    fireEvent.click(build);
    await waitFor(() => expect(actions.openBrief).toHaveBeenCalledWith("b1"));
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      kind: "system-design",
      topic: "Design a cache layer",
    });
    expect(lists.refresh).toHaveBeenCalled();
  });

  it("says when a brief could not be built", async () => {
    buildStatus = 502;
    view([]);
    fireEvent.change(screen.getByLabelText("Topic"), {
      target: { value: "X" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Build briefing" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The briefing couldn’t be built.",
    );
  });

  it("sets up a behavioural pack in place and opens it to draft", () => {
    view([]);
    fireEvent.click(screen.getByRole("radio", { name: "Behavioural" }));
    expect(
      screen.getByText("Prepare for a screening or behavioural interview"),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Create pack" }));
    expect(lists.refresh).toHaveBeenCalled();
    expect(actions.go).toHaveBeenCalledWith("briefings", ["prep-new", "draft"]);
  });

  it("shows a brief to say out loud", async () => {
    view(["brief", "b1"]);
    expect(await screen.findByText(/React re-renders on/)).toBeVisible();
    expect(screen.getByText("state", { selector: "strong" })).toBeVisible();
    // A model's bold markers around a heading are not shown literally.
    expect(screen.getByText("Triggers")).toBeVisible();
    expect(screen.getByText("A search box and a big table.")).toBeVisible();
    expect(screen.getByText("Only when props change.")).toBeVisible();
    expect(screen.getByText("Props, shallowly.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /useTransition/ }));
    expect(screen.queryByText("Props, shallowly.")).toBeNull();
    expect(screen.getByText("For slow updates.")).toBeVisible();
    expect(screen.getByLabelText("Time left")).toHaveTextContent("1:30");
  });

  it("deletes a brief after confirming", async () => {
    view(["brief", "b1"]);
    await screen.findByText(/React re-renders on/);
    const confirm = vi
      .spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete brief" }));
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete brief" }));
    await waitFor(() => expect(actions.go).toHaveBeenCalledWith("briefings"));
    confirm.mockRestore();
  });

  it("says when a brief cannot be loaded, and opens packs", async () => {
    view(["brief", "missing"]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This brief couldn’t be loaded.",
    );
    view(["pack-1"]);
    expect(screen.getByText("Preparation pack pack-1")).toBeVisible();
  });

  it("shows the empty list and marks the selected brief or pack", async () => {
    const { rerender } = render(
      <BriefingsView
        rest={[]}
        actions={actions}
        lists={{ ...lists, briefings: [], briefs: [] }}
        onDirtyChange={() => undefined}
      />,
    );
    expect(screen.getByText("Your briefings will appear here.")).toBeVisible();
    rerender(
      <BriefingsView
        rest={["brief", "b1"]}
        actions={actions}
        lists={lists}
        onDirtyChange={() => undefined}
      />,
    );
    expect(
      screen.getByRole("button", { name: /How does React re-render/ }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("button", { name: /Northwind recruiter/ }),
    ).not.toHaveAttribute("aria-current");
    await screen.findByText(/React re-renders on/);
    rerender(
      <BriefingsView
        rest={["pack-1", "draft"]}
        actions={actions}
        lists={lists}
        onDirtyChange={() => undefined}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Northwind recruiter/ }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByText("Preparation pack pack-1 (drafting)"),
    ).toBeVisible();
  });

  it("ignores blank topics and blocks a second build while the first is pending", async () => {
    let release: (response: Response) => void = () => undefined;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    view([]);
    const topic = screen.getByRole("textbox", { name: "Topic" });
    fireEvent.change(topic, { target: { value: "   " } });
    expect(
      screen.getByRole("button", { name: "Build briefing" }),
    ).toBeDisabled();
    fireEvent.submit(topic);
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(topic, { target: { value: "  Explain a cache  " } });
    fireEvent.click(screen.getByRole("button", { name: "Build briefing" }));
    expect(screen.getByRole("button", { name: "Building…" })).toBeDisabled();
    fireEvent.submit(topic);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body)),
    ).toEqual({ kind: "concept", topic: "Explain a cache" });
    await act(async () => release(Response.json(brief)));
    await waitFor(() => expect(actions.openBrief).toHaveBeenCalledWith("b1"));
  });

  it("retries a failed build and clears its error", async () => {
    buildStatus = 502;
    view([]);
    fireEvent.change(screen.getByRole("textbox", { name: "Topic" }), {
      target: { value: "State" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Build briefing" }));
    await screen.findByRole("alert");
    expect(actions.openBrief).not.toHaveBeenCalled();
    expect(lists.refresh).not.toHaveBeenCalled();
    buildStatus = 200;
    fireEvent.click(screen.getByRole("button", { name: "Build briefing" }));
    await waitFor(() => expect(actions.openBrief).toHaveBeenCalledWith("b1"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(lists.refresh).toHaveBeenCalledTimes(1);
  });

  it("drops a late brief response after a different brief is selected", async () => {
    let release: (response: Response) => void = () => undefined;
    let signal: AbortSignal | null | undefined;
    vi.mocked(fetch).mockImplementationOnce((_path, init) => {
      signal = init?.signal;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    });
    const { rerender } = view(["brief", "b1"]);
    expect(screen.getByRole("status")).toHaveTextContent("Loading brief…");
    rerender(
      <BriefingsView
        rest={["brief", "missing"]}
        actions={actions}
        lists={lists}
        onDirtyChange={() => undefined}
      />,
    );
    expect(signal?.aborted).toBe(true);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This brief couldn’t be loaded.",
    );
    await act(async () => release(Response.json(brief)));
    expect(screen.queryByText(/React re-renders on/)).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This brief couldn’t be loaded.",
    );
  });

  it("collapses an open follow-up when it is clicked again", async () => {
    view(["brief", "b1"]);
    await screen.findByText(/React re-renders on/);
    const question = screen.getByRole("button", {
      name: "What does memo compare?",
    });
    expect(question).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(question);
    expect(question).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Props, shallowly.")).toBeNull();
    fireEvent.click(question);
    expect(screen.getByText("Props, shallowly.")).toBeVisible();
  });

  it("shows the empty CLI explanations state", () => {
    view(["explanations"]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "No concept explanations have been pushed yet.",
    );
    expect(selectionOf(["explanations"])).toEqual({ kind: "explanations" });
  });

  it("lists CLI explanations and opens the first while later explanations start collapsed", () => {
    const explanations = [
      { title: "State ownership", topic: "React", markdown: "Keep one owner." },
      { title: "Follow-up", topic: "React", markdown: "Lift shared state." },
    ];
    const { rerender } = render(
      <BriefingsView
        rest={[]}
        actions={actions}
        lists={lists}
        explanations={explanations}
        onDirtyChange={() => undefined}
      />,
    );
    const entry = screen.getByRole("button", {
      name: /State ownership.*Concept explanations/,
    });
    fireEvent.click(entry);
    expect(actions.go).toHaveBeenCalledWith("briefings", ["explanations"]);
    rerender(
      <BriefingsView
        rest={["explanations"]}
        actions={actions}
        lists={lists}
        explanations={explanations}
        onDirtyChange={() => undefined}
      />,
    );
    expect(
      screen.getByRole("button", {
        name: /State ownership.*Concept explanations/,
      }),
    ).toHaveAttribute("aria-current", "page");
    const groups = screen.getAllByRole("group");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toHaveAttribute("open");
    expect(groups[1]).not.toHaveAttribute("open");
    expect(screen.getByText("Keep one owner.")).toBeVisible();
    expect(screen.getByText("Lift shared state.")).not.toBeVisible();
  });

  it("reads the selection from the path", () => {
    expect(selectionOf([])).toEqual({ kind: "new" });
    expect(selectionOf(["brief", "b1"])).toEqual({ kind: "brief", id: "b1" });
    expect(selectionOf(["brief"])).toEqual({
      kind: "pack",
      id: "brief",
      draft: false,
    });
    expect(selectionOf(["pack-1", "draft"])).toEqual({
      kind: "pack",
      id: "pack-1",
      draft: true,
    });
  });
});

describe("PracticeTimer", () => {
  it("pauses and resumes practice without resetting the remaining time", () => {
    vi.useFakeTimers();
    const { unmount } = render(<PracticeTimer seconds={10} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Practise it out loud" }),
    );
    act(() => vi.advanceTimersByTime(2000));
    fireEvent.click(screen.getByRole("button", { name: "Pause practice" }));
    expect(screen.getByLabelText("Time left")).toHaveTextContent("0:08");
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByLabelText("Time left")).toHaveTextContent("0:08");
    fireEvent.click(
      screen.getByRole("button", { name: "Practise it out loud" }),
    );
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByLabelText("Time left")).toHaveTextContent("0:07");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("counts down, stops at zero and starts again", () => {
    vi.useFakeTimers();
    render(<PracticeTimer seconds={3} />);
    const button = screen.getByRole("button", { name: "Practise it out loud" });
    fireEvent.click(button);
    expect(
      screen.getByRole("button", { name: "Pause practice" }),
    ).toBeVisible();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByLabelText("Time left")).toHaveTextContent("0:02");
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByLabelText("Time left")).toHaveTextContent("0:00");
    expect(screen.getByText("Time — how did it go?")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Practise it out loud" }),
    );
    expect(screen.getByLabelText("Time left")).toHaveTextContent("0:03");
  });
});
