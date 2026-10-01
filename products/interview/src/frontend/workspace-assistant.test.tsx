import { createAssistantClient } from "@omnitech-assistant/sdk";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Workspace } from "./workspace";

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

vi.mock("@oc-tech/omni-ui-components", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@oc-tech/omni-ui-components")>();
  return {
    ...actual,
    Drawer: ({
      open,
      onOpenChange,
      children,
    }: {
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
      children: ReactNode;
    }) => (
      <div data-testid="inspector-drawer" data-open={open ? "true" : "false"}>
        {open ? children : null}
        <button type="button" onClick={() => onOpenChange?.(false)}>
          Dismiss drawer
        </button>
      </div>
    ),
    DrawerContent: ({
      children,
      className,
      "aria-label": ariaLabel,
    }: {
      children: ReactNode;
      className?: string;
      "aria-label"?: string;
    }) => (
      <div role="dialog" aria-label={ariaLabel} className={className}>
        {children}
      </div>
    ),
    DrawerHeader: ({
      children,
      className,
    }: {
      children: ReactNode;
      className?: string;
    }) => <header className={className}>{children}</header>,
    DrawerTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    DrawerDescription: ({ children }: { children: ReactNode }) => (
      <p>{children}</p>
    ),
  };
});

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    loadAddon() {}
    open() {}
    writeln() {}
    write() {}
    onData() {
      return { dispose() {} };
    }
    dispose() {}
  },
}));

beforeEach(() => {
  window.history.replaceState({}, "", "/");
  vi.unstubAllGlobals();
  class MockWebSocket {
    static OPEN = 1;
    readyState = MockWebSocket.OPEN;
    addEventListener() {}
    send() {}
    close() {}
  }
  vi.stubGlobal("WebSocket", MockWebSocket);
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

const origin = { workspaceId: "w", artifactId: "a", artifactRevision: 3 };
const stamp = "2026-10-01T12:00:00.000Z";
const proposedAnswer = {
  title: "Optimistic concurrency",
  language: "typescript",
  answerMarkdown: "Compare the expected revision before writing.",
  code: "export const ok = true;",
  usageCode: "",
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

// A small server for the two HTTP APIs the workspace talks to: its canonical
// draft, and the assistant (threads, runs, proposals).
function installServer() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const server = {
    revision: 3,
    value: {
      question: "Question from the server",
      notes: "",
      answer: null as unknown,
    },
    proposal: true,
  };
  const record = () => ({
    origin: { ...origin, artifactRevision: server.revision },
    value: server.value,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      if (path === "/api/interview/workspaces/w/artifacts/a") {
        if (method === "PATCH") {
          server.value = { ...server.value, ...body.patch };
          server.revision += 1;
        }
        return json(record());
      }
      if (path === "/api/v1/generate") return json(proposedAnswer);
      if (path.startsWith("/api/assistant/v1/threads?"))
        return json([
          {
            id: "t1",
            title: "Test",
            revision: 0,
            createdAt: stamp,
            updatedAt: stamp,
          },
        ]);
      if (path === "/api/assistant/v1/threads/t1")
        return json({
          thread: {
            id: "t1",
            title: "Test",
            revision: 0,
            createdAt: stamp,
            updatedAt: stamp,
          },
          binding: { workspaceId: "w", artifactId: "a" },
          messages: [],
          nextCursor: null,
          activeRun: null,
        });
      if (path.startsWith("/api/assistant/v1/runs?")) return json([]);
      if (path === "/api/assistant/v1/runs")
        return json({ code: "forbidden", message: "forbidden" }, 403);
      if (path === "/api/assistant/v1/threads/t1/proposals")
        return json(
          server.proposal
            ? [
                {
                  proposal: {
                    id: "p1",
                    origin: record().origin,
                    patch: { answer: proposedAnswer },
                    evidence: [],
                  },
                  status: "pending",
                },
              ]
            : [],
        );
      if (path === "/api/assistant/v1/proposals/p1/apply") {
        server.value = { ...server.value, answer: proposedAnswer };
        server.revision += 1;
        server.proposal = false;
        return json({ proposalId: "p1", artifactRevision: server.revision });
      }
      return json([]);
    }),
  );
  return { calls, server };
}

function renderAssistant() {
  const client = createAssistantClient({ baseUrl: "/api/assistant/v1" });
  render(
    <Workspace
      assistant={{
        client,
        profileId: "local",
        workspaceId: "w",
        artifactId: "a",
      }}
    />,
  );
}

describe("Workspace with the assistant", () => {
  it("loads the canonical draft from the server", async () => {
    installServer();
    renderAssistant();
    await waitFor(() =>
      expect(screen.getByLabelText("Interview question")).toHaveValue(
        "Question from the server",
      ),
    );
  });

  it("reloads the canonical draft on request", async () => {
    const { server } = installServer();
    renderAssistant();
    await screen.findByRole("button", { name: "Reload canonical draft" });
    server.value = { ...server.value, question: "Changed on the server" };
    fireEvent.click(
      screen.getByRole("button", { name: "Reload canonical draft" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Interview question")).toHaveValue(
        "Changed on the server",
      ),
    );
  });

  it("saves local edits to the canonical draft before a message is sent", async () => {
    const { calls } = installServer();
    renderAssistant();
    await waitFor(() =>
      expect(screen.getByLabelText("Interview question")).toHaveValue(
        "Question from the server",
      ),
    );
    fireEvent.change(screen.getByLabelText("Interview question"), {
      target: { value: "My edited question" },
    });
    fireEvent.change(screen.getByLabelText("Assistant message"), {
      target: { value: "Tighten the answer" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(calls.some((call) => call.path === "/api/assistant/v1/runs")).toBe(
        true,
      ),
    );
    const patch = calls.findIndex((call) => call.method === "PATCH");
    const run = calls.findIndex(
      (call) => call.path === "/api/assistant/v1/runs",
    );
    expect(patch).toBeGreaterThan(-1);
    expect(patch).toBeLessThan(run);
    expect(calls[patch]?.body).toMatchObject({
      origin: { artifactRevision: 3 },
      patch: { question: "My edited question" },
    });
  });

  it("shows a proposal for review and applies it to the draft without saving", async () => {
    const { calls } = installServer();
    renderAssistant();
    await screen.findByText("Optimistic concurrency");
    expect(screen.getByLabelText("Review proposed answer")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Apply to draft" }));
    await screen.findByText("Reviewed proposal applied to draft. Not saved.");
    expect(
      calls.some(
        (call) => call.path === "/api/assistant/v1/proposals/p1/apply",
      ),
    ).toBe(true);
  });
  it("generates an answer with the main app's endpoint, and the assistant then sees it", async () => {
    const { calls } = installServer();
    renderAssistant();
    await waitFor(() =>
      expect(screen.getByLabelText("Interview question")).toHaveValue(
        "Question from the server",
      ),
    );
    // No provider picker: the server's model settings decide.
    expect(screen.queryByLabelText("Answer provider")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    await screen.findByText("Draft generated. It has not been saved.");
    const generate = calls.find((call) => call.path === "/api/v1/generate");
    expect(generate?.body).toEqual({
      question: "Question from the server",
      language: "auto",
    });
    // Sending a message saves the generated answer so the assistant can read it.
    fireEvent.change(screen.getByLabelText("Assistant message"), {
      target: { value: "What is the time complexity?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(calls.some((call) => call.method === "PATCH")).toBe(true),
    );
    expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject({
      patch: { answer: { title: "Optimistic concurrency" } },
    });
  });
});
