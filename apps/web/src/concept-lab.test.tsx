import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConceptLab } from "./concept-lab";

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("./browser-terminal", () => ({
  BrowserTerminal: ({ sessionName }: { sessionName?: string }) => (
    <div data-testid="browser-terminal">{sessionName}</div>
  ),
}));

function response(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("ConceptLab", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("generates, saves, opens, and deletes a briefing", async () => {
    const saved = {
      id: "123e4567-e89b-42d3-a456-426614174000",
      topic: "React reconciliation",
      title: "Reconciliation",
      markdown: "# Reconciliation",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };
    let list = [] as (typeof saved)[];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const path = String(input);
        if (path.endsWith("/explain"))
          return response({
            title: "Reconciliation",
            markdown: "# Reconciliation",
          });
        if (path.endsWith("/explanations") && init?.method === "POST") {
          list = [saved];
          return response(saved, 201);
        }
        if (path.includes(`/explanations/${saved.id}`)) {
          list = [];
          return response({ deleted: true });
        }
        if (path.endsWith("/explanations")) return response(list);
        throw new Error(path);
      }),
    );

    render(<ConceptLab />);
    await userEvent.selectOptions(
      screen.getByLabelText("Explanation provider"),
      "openai",
    );
    const topic = screen.getByLabelText("What do you need to explain?");
    await userEvent.type(topic, "React reconciliation");
    await userEvent.click(screen.getByRole("button", { name: "Explain" }));
    expect(await screen.findByText("# Reconciliation")).toBeVisible();
    expect(topic).toHaveValue("");
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/explain",
      expect.objectContaining({
        body: JSON.stringify({
          topic: "React reconciliation",
          providerId: "openai",
        }),
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Briefing saved.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Saved" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Delete Reconciliation" }),
    );
    expect(await screen.findByText("Saved briefing deleted.")).toBeVisible();
  });

  it("restores local drafts and accepts CLI updates", async () => {
    localStorage.setItem(
      "interview-studio.concept-lab",
      JSON.stringify({ topic: "Hooks", title: "Hooks", markdown: "Local" }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response([])),
    );
    const { rerender } = render(<ConceptLab />);
    expect(await screen.findByText("Local")).toBeVisible();
    expect(screen.getByLabelText("What do you need to explain?")).toHaveValue(
      "",
    );

    rerender(
      <ConceptLab
        externalDraft={{
          topic: "Queues",
          title: "Queues",
          markdown: "External",
        }}
      />,
    );
    expect(await screen.findByText("External")).toBeVisible();
    expect(
      screen.getByText("Concept Lab updated through the CLI."),
    ).toBeVisible();
  });

  it("renders appended CLI answers newest first without an outer collapse", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response([])),
    );
    render(
      <ConceptLab
        externalDrafts={[
          { topic: "React", title: "React", markdown: "Root briefing" },
          {
            topic: "Caching",
            title: "Cache follow-up",
            markdown: "LRU answer",
          },
        ]}
      />,
    );

    const newest = await screen.findByText("LRU answer");
    const oldest = screen.getByText("Root briefing");
    expect(
      newest.compareDocumentPosition(oldest) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Follow-up/ }),
    ).not.toBeInTheDocument();
  });

  it("appends a generated follow-up when a session already exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) =>
        String(input).endsWith("/explain")
          ? response({ title: "Follow-up", markdown: "Generated follow-up" })
          : response([]),
      ),
    );
    render(
      <ConceptLab
        externalDraft={{
          topic: "React state",
          title: "State ownership",
          markdown: "Root briefing",
        }}
      />,
    );

    await userEvent.selectOptions(
      screen.getByLabelText("Explanation provider"),
      "openai",
    );
    await userEvent.type(
      screen.getByLabelText("What do you need to explain?"),
      "How should state be shared?",
    );
    await userEvent.click(screen.getByRole("button", { name: "Explain" }));

    expect(
      await screen.findByText("Answer added to the top of Concept Lab."),
    ).toBeVisible();
    const newest = screen.getByText("Generated follow-up");
    const oldest = screen.getByText("Root briefing");
    expect(
      newest.compareDocumentPosition(oldest) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByLabelText("What do you need to explain?")).toHaveValue(
      "",
    );
  });

  it("opens saved content and starts a new briefing", async () => {
    const onClearExternal = vi.fn();
    const onInspectorClose = vi.fn();
    const onTerminalClose = vi.fn();
    const saved = {
      id: "123e4567-e89b-42d3-a456-426614174000",
      topic: "Hash maps",
      title: "Hash maps",
      markdown: "Fast lookup",
      createdAt: "2026-07-25T00:00:00.000Z",
      updatedAt: "2026-07-25T00:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response([saved])),
    );
    const { unmount } = render(
      <ConceptLab
        inspectorOpen
        terminalOpen
        onClearExternal={onClearExternal}
        onInspectorClose={onInspectorClose}
        onTerminalClose={onTerminalClose}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Saved" }));
    const savedPanel = await screen.findByLabelText("Saved briefings");
    const openButton = savedPanel.querySelector(
      ".concept-saved-item > button:first-child",
    );
    expect(openButton).not.toBeNull();
    await userEvent.click(openButton as HTMLButtonElement);
    expect(screen.getByText("Fast lookup")).toBeVisible();
    await userEvent.selectOptions(
      screen.getByLabelText("Explanation provider"),
      "codex",
    );
    await userEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getByLabelText("What do you need to explain?")).toHaveValue(
      "",
    );
    expect(screen.getByLabelText("Explanation provider")).toHaveValue("");
    expect(screen.queryByText("Fast lookup")).not.toBeInTheDocument();
    expect(onTerminalClose).toHaveBeenCalledOnce();
    expect(onInspectorClose).toHaveBeenCalledOnce();
    expect(onClearExternal).toHaveBeenCalled();
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/v1/playground-control",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            view: "concept-lab",
            explanation: null,
            panel: "output",
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(
        JSON.parse(
          window.localStorage.getItem("interview-studio.concept-lab") ?? "{}",
        ),
      ).toMatchObject({
        topic: "",
        answerTopic: "",
        provider: "",
        title: "",
        markdown: "",
        followUps: [],
        terminalSession: "workspace",
      }),
    );
    unmount();
    render(<ConceptLab />);
    expect(screen.getByLabelText("What do you need to explain?")).toHaveValue(
      "",
    );
  });

  it("reports API failures and closes the saved drawer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) =>
        String(input).endsWith("/explanations")
          ? response([])
          : response({ error: { message: "Provider unavailable" } }, 503),
      ),
    );
    render(<ConceptLab />);
    await userEvent.selectOptions(
      screen.getByLabelText("Explanation provider"),
      "openai",
    );
    await userEvent.type(
      screen.getByLabelText("What do you need to explain?"),
      "React",
    );
    await userEvent.click(screen.getByRole("button", { name: "Explain" }));
    expect(await screen.findByText("Provider unavailable")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Saved" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Close saved briefings" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Close saved briefings" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("discards malformed drafts and reports save failures", async () => {
    localStorage.setItem("interview-studio.concept-lab", "{broken");
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        if (
          String(input).endsWith("/explanations") &&
          init?.method === "POST"
        ) {
          return response({}, 500);
        }
        return response([]);
      }),
    );
    render(
      <ConceptLab
        externalDraft={{
          topic: "Caching",
          title: "Caching",
          markdown: "Trade memory for latency.",
        }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("Request failed with HTTP 500."),
    ).toBeVisible();
  });

  it("normalizes incomplete locally stored drafts", async () => {
    localStorage.setItem("interview-studio.concept-lab", "{}");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response([])),
    );
    render(<ConceptLab />);
    expect(
      await screen.findByLabelText("What do you need to explain?"),
    ).toHaveValue("");
    expect(
      screen.getByText("Build a clear answer you can say out loud."),
    ).toBeVisible();
    expect(screen.getByLabelText("Explanation provider")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Explain" })).toBeDisabled();
  });

  it("selects LM Studio for compatible generation", async () => {
    const fetch = vi.fn((input: string | URL | Request) =>
      String(input).endsWith("/explain")
        ? response({ title: "Local", markdown: "Local model answer" })
        : response([]),
    );
    vi.stubGlobal("fetch", fetch);
    render(<ConceptLab />);

    await userEvent.selectOptions(
      screen.getByLabelText("Explanation provider"),
      "lm-studio",
    );
    await userEvent.type(
      screen.getByLabelText("What do you need to explain?"),
      "React effects",
    );
    await userEvent.click(screen.getByRole("button", { name: "Explain" }));

    expect(await screen.findByText("Local model answer")).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/explain",
      expect.objectContaining({
        body: JSON.stringify({
          topic: "React effects",
          providerId: "lm-studio",
        }),
      }),
    );
  });

  it("starts Codex in a new terminal session without changing the topic", async () => {
    const onTerminalOpen = vi.fn();
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) =>
      String(input).endsWith("/concept-sessions")
        ? response(
            {
              name: "concept-abc",
              command: "/explain React rendering",
            },
            201,
          )
        : response([]),
    );
    vi.stubGlobal("fetch", fetch);
    const { unmount } = render(
      <ConceptLab onTerminalClose={vi.fn()} onTerminalOpen={onTerminalOpen} />,
    );

    await userEvent.selectOptions(
      screen.getByLabelText("Explanation provider"),
      "codex",
    );
    const topic = screen.getByLabelText("What do you need to explain?");
    await userEvent.type(topic, "React rendering");
    await userEvent.click(screen.getByRole("button", { name: "Explain" }));

    expect(topic).toHaveValue("React rendering");
    expect(onTerminalOpen).toHaveBeenCalledOnce();
    expect(
      await screen.findByText(
        /Codex session “concept-abc” started.*\/explain result/,
      ),
    ).toBeVisible();
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/concept-sessions",
      expect.objectContaining({
        body: JSON.stringify({ topic: "React rendering" }),
      }),
    );
    expect(fetch).not.toHaveBeenCalledWith(
      "/api/v1/explain",
      expect.anything(),
    );

    await waitFor(() =>
      expect(
        JSON.parse(
          window.localStorage.getItem("interview-studio.concept-lab") ?? "{}",
        ),
      ).toMatchObject({ terminalSession: "concept-abc" }),
    );
    unmount();
    render(
      <ConceptLab
        inspectorOpen
        terminalOpen
        onTerminalClose={vi.fn()}
        onTerminalOpen={vi.fn()}
      />,
    );
    expect(
      await screen.findByText("tmux · concept-abc · project root"),
    ).toBeVisible();
  });
});
