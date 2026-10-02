import type { HostHooks } from "@omnitech-assistant/react";
import type { AssistantClient } from "@omnitech-assistant/sdk";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudioContext, type StudioViewBinding } from "../context";
import { WorkspaceView } from "./workspace-view";

// The editor is a textarea here; CodeMirror needs a real layout engine.
vi.mock("@uiw/react-codemirror", () => ({
  default: ({
    value,
    onChange,
    "aria-label": label,
  }: {
    value: string;
    onChange: (value: string) => void;
    "aria-label"?: string;
  }) => (
    <textarea
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const host = vi.hoisted(() => ({
  state: {
    preview: null as unknown,
    applied: null as unknown,
    discardPreview: () => undefined,
    applyPreview: async () => undefined,
    undoApplied: async () => undefined,
  },
}));
vi.mock("@omnitech-assistant/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@omnitech-assistant/react")>()),
  useAssistantHost: () => host.state,
}));

const guide = {
  version: 1,
  understand: {
    prompt: "Find two numbers that add up to **target**.",
    examples: [{ input: "[2,7,11], 9", output: "[0,1]" }],
    constraints: ["Exactly one answer"],
    clarify: ["Can values repeat?", "Return order?"],
  },
  plan: {
    steps: ["Keep a map of seen values.", "Look up the complement."],
    complexity: { time: "O(n)", space: "O(n)" },
  },
  edgeCases: [
    { name: "No pair", test: "returns null" },
    { name: "Duplicates", test: "a renamed test" },
  ],
  explain: [{ heading: "The problem", body: "Pairs that sum to a target." }],
  talkingPoints: ["One pass", "Hash map", "Early return"],
};
const answer = {
  title: "Two sum",
  language: "typescript",
  answerMarkdown: "## Question\n\nRendered.",
  code: "export function twoSum() {}",
  usageCode: "console.log(twoSum());",
  testCode: "it('returns null')",
  guide,
};

type Call = { method: string; path: string; body?: Record<string, unknown> };
let calls: Call[];
let server: {
  revision: number;
  value: Record<string, unknown>;
  patchStatus: number;
  run: Record<string, unknown>;
  diagnostics: unknown[];
};

const base = "/api/interview/workspaces/interview/artifacts/q1";
function installServer(value: Record<string, unknown>) {
  calls = [];
  server = {
    revision: 3,
    value,
    patchStatus: 200,
    run: {
      stdout: "1 failed",
      stderr: "",
      exitCode: 1,
      durationMs: 1200,
      timedOut: false,
      tests: [
        {
          name: "suite › returns null",
          status: "passed",
          durationMs: 2,
          location: { editor: "tests", line: 1 },
        },
        {
          name: "handles negatives",
          status: "failed",
          durationMs: 3,
          message: "expected 2 to be 3",
          location: { editor: "tests", line: 3 },
        },
      ],
    },
    diagnostics: [],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path: input, body });
      const record = () => ({
        origin: {
          workspaceId: "interview",
          artifactId: "q1",
          artifactRevision: server.revision,
        },
        value: server.value,
      });
      if (input === base) {
        if (method === "PATCH") {
          if (server.patchStatus !== 200)
            return Response.json(
              { code: "revision-conflict" },
              { status: server.patchStatus },
            );
          server.value = { ...server.value, ...body.patch };
          server.revision += 1;
        }
        return Response.json(record());
      }
      if (input === `${base}/run-code`)
        return Response.json({ execution: server.run });
      if (input === `${base}/save`) return Response.json({ ok: true });
      if (input === "/api/v1/syntax-check")
        return Response.json({
          stdout: "",
          stderr: "",
          exitCode: 0,
          durationMs: 5,
          timedOut: false,
          diagnostics: server.diagnostics,
        });
      if (input === "/api/v1/generate") return Response.json(answer);
      if (input === "/api/v1/answers?artifact=q1")
        return Response.json([
          {
            ...answer,
            title: "Saved two sum",
            code: "// saved",
            id: "q1:1",
            question: "Two sum",
            notes: "",
            createdAt: "2026-10-01T10:00:00.000Z",
            updatedAt: "2026-10-01T10:00:00.000Z",
          },
        ]);
      return Response.json({}, { status: 404 });
    }),
  );
}

let binding: StudioViewBinding;
let slot: HTMLElement;
const refreshLists = vi.fn();
function renderView() {
  slot = document.createElement("div");
  document.body.append(slot);
  const utils = render(
    <StudioContext.Provider
      value={{
        theme: "light",
        toggleTheme: () => undefined,
        headerSlot: slot,
        bindView: (next) => {
          binding = next;
          return () => undefined;
        },
        refreshLists,
        setFocus: () => undefined,
      }}
    >
      <WorkspaceView
        assistant={{
          client: {} as AssistantClient,
          profileId: "local",
          workspaceId: "interview",
          artifactId: "q1",
        }}
      />
    </StudioContext.Provider>,
  );
  return { ...utils, header: within(slot) };
}
// A stage in the stepper (the stage pane has its own Next/previous buttons).
const step = (label: string) =>
  within(screen.getByRole("navigation", { name: "Stages" })).getByRole(
    "button",
    { name: new RegExp(`${label}$`) },
  );
const patches = () => calls.filter((call) => call.method === "PATCH");
const lastPatch = () =>
  patches().at(-1)?.body?.["patch"] as Record<string, unknown>;

beforeEach(() => {
  vi.unstubAllGlobals();
  refreshLists.mockClear();
  host.state = { ...host.state, preview: null, applied: null };
  vi.stubGlobal("crypto", { randomUUID: () => "request-1" });
});

describe("WorkspaceView: a new question", () => {
  beforeEach(() =>
    installServer({
      question: "New interview question",
      notes: "",
      answer: null,
    }),
  );

  it("starts from a pasted question that the person solves themselves", async () => {
    renderView();
    await screen.findByText("What’s the question?");
    expect(refreshLists).toHaveBeenCalled();
    const solve = screen.getByRole("button", { name: "Solve it myself" });
    expect(solve).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Interview question"), {
      target: { value: "# Reverse a list\nIn place." },
    });
    fireEvent.change(screen.getByLabelText("Language"), {
      target: { value: "ruby" },
    });
    fireEvent.click(solve);
    // Without a guide, Understand shows the question as written.
    expect(await screen.findByText("The question")).toBeVisible();
    expect(step("Understand")).toHaveAttribute("aria-current", "step");
    await waitFor(() => expect(patches()).toHaveLength(1), { timeout: 2000 });
    expect(lastPatch()).toMatchObject({
      question: "# Reverse a list\nIn place.",
      answer: { title: "Reverse a list", language: "ruby", code: "" },
      progress: { stage: "understand", clarified: [] },
    });
  });

  it("drafts an answer and shows its guide", async () => {
    renderView();
    fireEvent.change(await screen.findByLabelText("Interview question"), {
      target: { value: "Two sum" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Draft with assistant" }),
    );
    expect(
      await screen.findByText(/Find two numbers that add up to/),
    ).toBeVisible();
    expect(screen.getByText("target", { selector: "strong" })).toBeVisible();
    expect(
      calls.find((call) => call.path === "/api/v1/generate")?.body,
    ).toEqual({ question: "Two sum", language: "auto" });
  });

  it("starts from an example", async () => {
    renderView();
    const examples = await screen.findAllByRole("button", {
      name: /PHP|React|TypeScript|Ruby/,
    });
    fireEvent.click(
      examples.find((button) => button.className === "ws-example-card")!,
    );
    await waitFor(() => expect(patches()).toHaveLength(1), { timeout: 2000 });
    expect(lastPatch()?.["answer"]).toBeTruthy();
  });

  it("reports a failed draft", async () => {
    renderView();
    vi.mocked(fetch).mockImplementationOnce(async () =>
      Response.json(
        { error: { message: "Model unavailable" } },
        { status: 503 },
      ),
    );
    fireEvent.change(await screen.findByLabelText("Interview question"), {
      target: { value: "Q" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Draft with assistant" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Model unavailable",
    );
  });
});

describe("WorkspaceView: a guided answer", () => {
  beforeEach(() =>
    installServer({
      question: "Two sum",
      notes: "",
      answer,
      progress: { stage: "understand", clarified: [] },
    }),
  );

  it("walks the stages and saves where the person is", async () => {
    const { header } = renderView();
    await screen.findByText(/Find two numbers/);
    expect(header.getByText("Two sum")).toBeVisible();
    expect(header.getByText("TypeScript")).toBeVisible();
    expect(screen.getByText("[2,7,11], 9 → [0,1]")).toBeVisible();
    expect(screen.getByText("0 of 2")).toBeVisible();
    const checks = screen.getAllByRole("checkbox");
    fireEvent.click(checks[0]!);
    fireEvent.click(checks[1]!);
    expect(screen.getByText("2 of 2")).toBeVisible();
    fireEvent.click(checks[0]!);
    expect(screen.getByText("1 of 2")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /Next: Plan/ }));
    expect(screen.getByText("Keep a map of seen values.")).toBeVisible();
    expect(screen.getAllByText("O(n)")).toHaveLength(2);
    await waitFor(
      () =>
        expect(lastPatch()).toMatchObject({
          progress: { stage: "plan", clarified: [1] },
        }),
      { timeout: 2000 },
    );
    expect(header.getByRole("status")).toHaveTextContent("Saved");

    fireEvent.click(screen.getByRole("button", { name: /Next: Code/ }));
    fireEvent.change(screen.getByLabelText("Scratchpad"), {
      target: { value: "map + complement" },
    });
    await waitFor(
      () => expect(lastPatch()).toMatchObject({ notes: "map + complement" }),
      { timeout: 2000 },
    );

    fireEvent.click(step("Explain"));
    expect(screen.getByText("Pairs that sum to a target.")).toBeVisible();
    expect(screen.getByText("Early return")).toBeVisible();
    expect(screen.getByLabelText("Time left")).toHaveTextContent("2:00");
    fireEvent.click(
      screen.getByRole("button", { name: /Practise it out loud/ }),
    );
    expect(
      screen.getByRole("button", { name: "Pause practice" }),
    ).toBeVisible();
  });

  it("runs the tests, lists each result and goes to a failing line", async () => {
    const { header } = renderView();
    await screen.findByText(/Find two numbers/);
    expect(screen.getByText(/Tests haven’t run yet/)).toBeVisible();
    fireEvent.click(header.getByRole("button", { name: /Run tests/ }));
    expect(await screen.findByText("1 / 2 passed · 1.2 s")).toBeVisible();
    const results = screen.getByRole("list", { name: "Test results" });
    expect(within(results).getByText("suite › returns null")).toBeVisible();
    expect(within(results).getByText("expected 2 to be 3")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Run tests/ }).closest("header"),
    ).toBeNull();
    fireEvent.click(
      within(results).getByRole("button", { name: "Go to line 3" }),
    );
    expect(
      screen.getByRole("tab", { name: /solution\.test\.ts/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      calls.find((call) => call.path === `${base}/run-code`)?.body,
    ).toEqual({
      origin: {
        workspaceId: "interview",
        artifactId: "q1",
        artifactRevision: 3,
      },
      requestId: "request-1",
    });

    // The Test stage maps edge cases onto those results.
    fireEvent.click(step("Test"));
    expect(screen.getByText(/returns null · passing/)).toBeVisible();
    expect(
      screen.getByText(/a renamed test · not found in tests/),
    ).toBeVisible();
    // Failing tests mark the Test step.
    expect(step("Test")).toHaveClass("current");
    fireEvent.click(step("Understand"));
    expect(step("Test")).toHaveClass("warn");

    fireEvent.click(screen.getByRole("tab", { name: "Output" }));
    expect(screen.getByText("1 failed")).toBeVisible();
  });

  it("lends the shell its draft, hooks and Run tests", async () => {
    renderView();
    await screen.findByText(/Find two numbers/);
    await waitFor(() =>
      expect(binding.origin).toMatchObject({ artifactRevision: 3 }),
    );
    binding.runTests!();
    expect(await screen.findByText("1 / 2 passed · 1.2 s")).toBeVisible();

    // A pending edit is saved before the assistant reads the draft.
    fireEvent.change(screen.getByLabelText("Edit solution.ts"), {
      target: { value: "export function twoSum(a) {}" },
    });
    const hooks = binding.hooks!.current as Required<HostHooks>;
    await expect(hooks.prepareSend()).resolves.toMatchObject({
      artifactRevision: 4,
    });
    expect(lastPatch()).toMatchObject({
      answer: { code: "export function twoSum(a) {}" },
    });

    // After an applied change the stored draft is shown.
    server.value = { ...server.value, question: "Two sum (edited)" };
    await act(() =>
      hooks.onApplied({} as never, {
        workspaceId: "interview",
        artifactId: "q1",
        artifactRevision: 4,
      }),
    );
    expect(screen.getByText("Assistant change applied.")).toBeVisible();
    expect(refreshLists).toHaveBeenCalled();
    await act(() =>
      hooks.onReverted({
        proposal: {
          origin: {
            workspaceId: "interview",
            artifactId: "q1",
            artifactRevision: 5,
          },
        },
      } as never),
    );

    // A previewed change to the open file is shown as a diff.
    act(() =>
      hooks.onPreview({
        changes: [{ id: "code", before: "a", after: "b" }],
      } as never),
    );
    expect(screen.getByLabelText("Previewed change")).toBeVisible();
    act(() => hooks.onContextChange([{ id: "guide" }] as never));
    expect(document.querySelector(".ws-stage")).toHaveClass(
      "assistant-in-context",
    );
  });

  it("resizes the results panel and remembers its height", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    renderView();
    await screen.findByText(/Find two numbers/);
    const results = () => screen.getByRole("region", { name: "Results" });
    const handle = screen.getByRole("separator", { name: "Resize results" });
    expect(results()).toHaveStyle({ height: "240px" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    expect(results()).toHaveStyle({ height: "256px" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    expect(results()).toHaveStyle({ height: "224px" });
    fireEvent.keyDown(handle, { key: "Home" });
    expect(results()).toHaveStyle({ height: "96px" });
    expect(store.get("interview-studio.results-height")).toBe("96");
    fireEvent.doubleClick(handle);
    expect(results()).toHaveStyle({ height: "240px" });
    // Collapsing the results hides the handle.
    fireEvent.click(screen.getByRole("button", { name: "Collapse results" }));
    expect(
      screen.queryByRole("separator", { name: "Resize results" }),
    ).toBeNull();
  });

  it("checks syntax as the person types", async () => {
    renderView();
    await screen.findByText(/Find two numbers/);
    server.diagnostics = [
      { line: 1, column: 4, message: "Expression expected." },
    ];
    fireEvent.change(screen.getByLabelText("Edit solution.ts"), {
      target: { value: "let = ;" },
    });
    fireEvent.click(screen.getByRole("tab", { name: /Problems/ }));
    expect(
      await screen.findByText("Expression expected.", {}, { timeout: 2000 }),
    ).toBeVisible();
    expect(screen.getByText("solution.ts:1:4")).toBeVisible();
    expect(
      calls.filter((call) => call.path === "/api/v1/syntax-check").at(-1)?.body,
    ).toEqual({ language: "typescript", code: "let = ;" });
  });

  it("saves and restores versions", async () => {
    const { header } = renderView();
    await screen.findByText(/Find two numbers/);
    fireEvent.click(header.getByRole("button", { name: /Versions/ }));
    const menu = await screen.findByRole("menu", { name: "Versions" });
    await within(menu).findByText("Saved two sum");
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: /Save this version/ }),
    );
    expect(
      await within(menu).findByText("Saved a version of this answer."),
    ).toBeVisible();
    expect(calls.some((call) => call.path === `${base}/save`)).toBe(true);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: /Saved two sum/ }),
    );
    await waitFor(
      () =>
        expect(lastPatch()).toMatchObject({
          answer: { title: "Saved two sum", code: "// saved" },
        }),
      { timeout: 2000 },
    );
    // Only answer fields are restored, never the version's bookkeeping.
    expect(lastPatch()?.["answer"]).not.toHaveProperty("id");
    confirm.mockRestore();
  });

  it("asks to reload when the draft changed elsewhere", async () => {
    const { header } = renderView();
    await screen.findByText(/Find two numbers/);
    server.patchStatus = 409;
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    expect(
      await header.findByText("Changed elsewhere", {}, { timeout: 2000 }),
    ).toBeVisible();
    server.patchStatus = 200;
    fireEvent.click(header.getByRole("button", { name: "Reload" }));
    expect(await header.findByText("Saved")).toBeVisible();
  });
});

describe("WorkspaceView: older answers and failures", () => {
  it("shows an answer without a guide as its Markdown", async () => {
    installServer({
      question: "Old question",
      notes: "",
      answer: {
        ...answer,
        guide: undefined,
        answerMarkdown: "## Approach\nOld prose.",
      },
    });
    renderView();
    expect(await screen.findByText("Old question")).toBeVisible();
    fireEvent.click(step("Plan"));
    expect(screen.getByText(/Old prose/)).toBeVisible();
  });

  it("says when the question cannot be loaded", async () => {
    installServer({});
    vi.mocked(fetch).mockImplementationOnce(async () =>
      Response.json({ code: "not-found" }, { status: 404 }),
    );
    renderView();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This question couldn’t be loaded (not-found).",
    );
  });
});
