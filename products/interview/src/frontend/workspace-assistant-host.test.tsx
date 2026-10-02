import type { AssistantConfig } from "@omnitech-assistant/react";
import type { AssistantClient, ProposalRecord } from "@omnitech-assistant/sdk";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Workspace } from "./workspace";

// The workspace's side of the assistant contract, driven through a fake host:
// the package's own panel is covered by workspace-assistant.test.tsx.
const host = vi.hoisted(() => ({
  config: undefined as unknown as AssistantConfig,
  version: 0,
  listeners: new Set<() => void>(),
  state: {} as Record<string, unknown>,
}));

vi.mock("@omnitech-assistant/react", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@omnitech-assistant/react")>();
  const { useSyncExternalStore } = await import("react");
  return {
    ...actual,
    AssistantRoot: ({
      config,
      children,
    }: {
      config: AssistantConfig;
      children: ReactNode;
    }) => {
      host.config = config;
      return <>{children}</>;
    },
    useAssistantHost: () => {
      useSyncExternalStore(
        (listener) => {
          host.listeners.add(listener);
          return () => host.listeners.delete(listener);
        },
        () => host.version,
      );
      return host.state;
    },
  };
});

vi.mock("@uiw/react-codemirror", () => ({
  default: ({
    value,
    onChange,
    onBlur,
    "aria-label": ariaLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    onBlur?: () => void;
    "aria-label"?: string;
  }) => (
    <textarea
      aria-label={ariaLabel ?? "Editable solution"}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
    />
  ),
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("./browser-terminal", () => ({
  BrowserTerminal: () => <div data-testid="browser-terminal" />,
}));

vi.mock("@oc-tech/omni-ui-components/dynamic-form", () => ({
  DynamicForm: ({
    formData,
    onChange,
  }: {
    formData: { question: string };
    onChange: (value: { question: string }) => void;
  }) => (
    <textarea
      aria-label="Interview question"
      value={formData.question}
      onChange={(event) => onChange({ question: event.target.value })}
    />
  ),
}));

function setHost(state: Record<string, unknown>) {
  act(() => {
    host.state = { ...host.state, ...state };
    host.version += 1;
    for (const listener of host.listeners) listener();
  });
}

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
  host.version = 0;
  host.state = {
    open: false,
    shortcut: "⌘J",
    toggle: vi.fn(),
    preview: null,
    applied: null,
    discardPreview: vi.fn(),
    applyPreview: vi.fn(async () => undefined),
    undoApplied: vi.fn(async () => undefined),
  };
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
});

const answer = {
  title: "Two sum",
  language: "typescript",
  answerMarkdown: "Use a map of seen values.",
  code: "const a = 1;\nconst b = 2;",
  usageCode: "console.log(a);",
  testCode: "",
};

function json(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

// The canonical draft API, plus the explicit save and run effects.
function installServer(exitCode = 0) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const server = {
    revision: 3,
    value: { question: "Find two numbers", notes: "", answer },
  };
  const record = () => ({
    origin: {
      workspaceId: "w",
      artifactId: "a",
      artifactRevision: server.revision,
    },
    value: server.value,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      const base = "/api/interview/workspaces/w/artifacts/a";
      if (path === base) {
        if (method === "PATCH") {
          server.value = { ...server.value, ...body.patch };
          server.revision += 1;
        }
        return json(record());
      }
      if (path === `${base}/save`) return json({ id: "s1" });
      if (path === `${base}/run-code`)
        return json({
          execution: {
            stdout: "1 passed",
            stderr: "",
            exitCode,
            timedOut: false,
            durationMs: 12,
          },
        });
      return json([]);
    }),
  );
  return { calls, server };
}

async function renderAssistant() {
  render(
    <Workspace
      assistant={{
        client: {} as AssistantClient,
        profileId: "local",
        workspaceId: "w",
        artifactId: "a",
      }}
    />,
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Interview question")).toHaveValue(
      "Find two numbers",
    ),
  );
}

const status = () => screen.getAllByRole("status").at(-1)!;
const preview = (changes: unknown[]) =>
  ({ changes }) as unknown as ProposalRecord;

describe("Workspace assistant host", () => {
  it("toggles the assistant from the toolbar and shows its shortcut", async () => {
    installServer();
    await renderAssistant();
    const toggle = screen.getByRole("button", { name: "Assistant" });
    expect(toggle).toHaveAttribute("title", "Assistant (⌘J)");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    expect(host.state["toggle"]).toHaveBeenCalled();
  });

  it("marks the question as in context when it is attached with @", async () => {
    installServer();
    await renderAssistant();
    expect(screen.queryByText("In assistant context")).toBeNull();
    act(() =>
      host.config.host?.onContextChange?.([{ id: "question" }] as never),
    );
    expect(screen.getByText("In assistant context")).toBeVisible();
  });

  it("previews a code change as a line diff without applying it", async () => {
    installServer();
    await renderAssistant();
    const change = {
      id: "code",
      label: "Main Solution",
      before: "const a = 1;\nconst b = 2;",
      after: "const a = 1;\nconst c = 3;",
    };
    act(() => host.config.host?.onPreview?.(preview([change])));
    setHost({ preview: { proposal: { id: "p1" } } });
    expect(
      screen.getByText("Previewing assistant change — not applied"),
    ).toBeVisible();
    const diff = screen.getByLabelText("Previewed change");
    const rows = diff.querySelectorAll(".assistant-preview-line");
    expect([...rows].map((row) => row.className.split(" ").at(-1))).toEqual([
      "same",
      "removed",
      "added",
    ]);
    // Removed lines have no number in the new version.
    expect(rows[1]?.textContent).toBe("const b = 2;");
    expect(rows[2]?.textContent).toBe("2const c = 3;");
    expect(
      screen.getByLabelText("Editable main solution").closest("div"),
    ).not.toBeVisible();

    // The Tests tab has no proposed change, so it keeps its editor.
    fireEvent.click(screen.getByRole("tab", { name: "Tests" }));
    expect(screen.queryByLabelText("Previewed change")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(host.state["discardPreview"]).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(host.state["applyPreview"]).toHaveBeenCalled();
  });

  it("offers Undo once a change is applied", async () => {
    installServer();
    await renderAssistant();
    setHost({ applied: { changes: [{ id: "code" }, { id: "testCode" }] } });
    expect(
      screen.getByText("Updated by assistant · 2 surfaces changed"),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(host.state["undoApplied"]).toHaveBeenCalled();
    setHost({ applied: { changes: [{ id: "code" }] } });
    expect(
      screen.getByText("Updated by assistant · 1 surface changed"),
    ).toBeVisible();
    setHost({ applied: {} });
    expect(screen.getByText("Updated by assistant")).toBeVisible();
  });

  it("shows the stored draft after an applied change or an undo", async () => {
    const { server } = installServer();
    await renderAssistant();
    const origin = { workspaceId: "w", artifactId: "a", artifactRevision: 3 };
    server.value = { ...server.value, question: "Changed by the assistant" };
    await act(() => host.config.host!.onApplied!({} as never, origin));
    expect(screen.getByLabelText("Interview question")).toHaveValue(
      "Changed by the assistant",
    );
    expect(status()).toHaveTextContent("Assistant change applied. Not saved.");

    server.value = { ...server.value, question: "Find two numbers" };
    await act(() =>
      host.config.host!.onReverted!({ proposal: { origin } } as never),
    );
    expect(screen.getByLabelText("Interview question")).toHaveValue(
      "Find two numbers",
    );
    expect(status()).toHaveTextContent("Assistant change undone.");
  });

  it("keeps local edits made while the assistant change was stored", async () => {
    const { server } = installServer();
    await renderAssistant();
    const origin = { workspaceId: "w", artifactId: "a", artifactRevision: 3 };
    server.value = { ...server.value, question: "Changed by the assistant" };
    const reload = host.config.host!.onApplied!({} as never, origin);
    fireEvent.change(screen.getByLabelText("Interview question"), {
      target: { value: "My own edit" },
    });
    await act(() => reload);
    expect(screen.getByLabelText("Interview question")).toHaveValue(
      "My own edit",
    );
    expect(status()).toHaveTextContent(
      "Assistant change stored; your local edits were kept. Reload to see it.",
    );
  });

  it("saves local edits before the assistant sends or applies", async () => {
    const { calls } = installServer();
    await renderAssistant();
    // Nothing changed locally: no write.
    await act(() => host.config.host!.beforeApply!({} as never));
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);

    fireEvent.change(screen.getByLabelText("Interview question"), {
      target: { value: "Edited" },
    });
    const [first, second] = await act(() =>
      Promise.all([
        host.config.host!.prepareSend!(),
        host.config.host!.prepareSend!(),
      ]),
    );
    // Concurrent sends share one write.
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ artifactRevision: 4 });
  });

  it("follows the assistant's theme switch", async () => {
    installServer();
    await renderAssistant();
    const before = document.documentElement.dataset["theme"];
    const next = before === "dark" ? "light" : "dark";
    act(() => host.config.host?.onThemeChange?.(next));
    expect(document.documentElement.dataset["theme"]).toBe(next);
    // Already on that theme: nothing changes.
    act(() => host.config.host?.onThemeChange?.(next));
    expect(document.documentElement.dataset["theme"]).toBe(next);
  });

  it("saves an immutable version and runs tests on the canonical draft", async () => {
    const { calls } = installServer();
    await renderAssistant();
    fireEvent.click(screen.getByRole("button", { name: "Save answer" }));
    await waitFor(() =>
      expect(status()).toHaveTextContent("Saved immutable answer version."),
    );
    expect(
      calls.find((call) => call.path.endsWith("/save"))?.body,
    ).toMatchObject({ origin: { artifactRevision: 3 } });
    expect(
      calls.some((call) => call.path === "/api/v1/answers?artifact=a"),
    ).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Run tests" }));
    await waitFor(() => expect(status()).toHaveTextContent("Tests passed"));
  });

  it("reports failing tests", async () => {
    installServer(1);
    await renderAssistant();
    fireEvent.click(screen.getByRole("button", { name: "Run tests" }));
    await waitFor(() => expect(status()).toHaveTextContent("Tests failed"));
  });

  it("leaves New and syntax checks to the assistant flow", async () => {
    installServer();
    await renderAssistant();
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(status()).toHaveTextContent(
      "Choose a new question using the question selector.",
    );
    expect(screen.getByLabelText("Interview question")).toHaveValue(
      "Find two numbers",
    );
    fireEvent.blur(screen.getByLabelText("Editable main solution"));
    expect(
      await screen.findByText(
        "Run tests explicitly to validate the canonical draft.",
      ),
    ).toBeVisible();
  });
});
