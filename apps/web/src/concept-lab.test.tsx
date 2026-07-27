import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConceptLab } from "./concept-lab";

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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
    const topic = screen.getByLabelText("What do you need to explain?");
    await userEvent.type(topic, "React reconciliation");
    await userEvent.click(screen.getByRole("button", { name: "Explain" }));
    expect(await screen.findByText("# Reconciliation")).toBeVisible();
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
    expect(await screen.findByDisplayValue("Hooks")).toBeVisible();

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

  it("renders appended CLI follow-ups as collapsed sections", async () => {
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

    expect(await screen.findByText("Root briefing")).toBeVisible();
    const trigger = screen.getByRole("button", {
      name: /Follow-up 1.*Cache follow-up/,
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("LRU answer")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Cache follow-up"));
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("LRU answer")).toBeVisible();
    expect(trigger.closest(".concept-follow-up-panel")).not.toBeNull();
    expect(trigger.closest(".concept-preview-card")).toBeNull();

    await userEvent.click(screen.getByText("Follow-up 1"));
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("LRU answer")).not.toBeInTheDocument();
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

    await userEvent.click(screen.getByRole("button", { name: "Explain" }));

    expect(
      await screen.findByText(
        "Follow-up appended to this Concept Lab session.",
      ),
    ).toBeVisible();
    await userEvent.click(screen.getByText("Follow-up"));
    expect(screen.getByText("Generated follow-up")).toBeVisible();
  });

  it("opens saved content and starts a new briefing", async () => {
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
    render(<ConceptLab />);
    await userEvent.click(screen.getByRole("button", { name: "Saved" }));
    const savedPanel = await screen.findByLabelText("Saved briefings");
    const openButton = savedPanel.querySelector(
      ".concept-saved-item > button:first-child",
    );
    expect(openButton).not.toBeNull();
    await userEvent.click(openButton as HTMLButtonElement);
    expect(screen.getByText("Fast lookup")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "New" }));
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
    expect(screen.getByText("Ready when you are")).toBeVisible();
  });
});
