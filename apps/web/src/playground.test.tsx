import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Playground } from "./playground";

vi.mock("@uiw/react-codemirror", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      aria-label="Editable solution"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const emptySnapshot = {
  revision: 0,
  updatedAt: "2026-07-24T00:00:00.000Z",
  value: {
    question: "",
    language: "auto",
    answer: null,
    notes: "",
    panel: "notes",
  },
};

const reactAnswer = {
  title: "Accessible Counter",
  language: "react",
  answerMarkdown: "Use semantic buttons and announce the current count.",
  code: "function App() { return <button>Count</button>; }",
  testCode: "expect(screen.getByRole('button')).toBeVisible();",
};

const phpAnswer = {
  title: "Frequency Map",
  language: "php",
  answerMarkdown: "Count each value in one pass.",
  code: "<?php echo 'ok';",
  testCode: "expect output ok",
};

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function installFetch(
  handler?: (path: string, init?: RequestInit) => Promise<Response>,
) {
  const fetchMock = vi.fn(
    (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input);
      if (handler) return handler(path, init);
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control"))
        return jsonResponse(emptySnapshot);
      throw new Error(`Unexpected request: ${path}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderSettled() {
  render(<Playground />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("Playground", () => {
  it("starts as an accessible unsaved draft with unavailable actions", async () => {
    installFetch();
    await renderSettled();

    expect(
      screen.getByRole("heading", { name: "Interview Answers Playground" }),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Interview question" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
    expect(
      screen.getByRole("navigation", { name: "Inspector panels" }),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Private notes" }),
    ).toBeVisible();
  });

  it("generates a routed React draft from the question controls", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(async (path, init) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control"))
        return jsonResponse(emptySnapshot);
      if (path.endsWith("/generate")) {
        expect(init).toMatchObject({
          method: "POST",
          body: JSON.stringify({
            question: "Build an accessible counter",
            language: "react",
          }),
        });
        return jsonResponse(reactAnswer);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();

    await user.type(
      screen.getByRole("textbox", { name: "Interview question" }),
      "Build an accessible counter",
    );
    await user.selectOptions(screen.getByLabelText("Language"), "react");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(
      await screen.findByRole("heading", { name: "Accessible Counter" }),
    ).toBeVisible();
    expect(screen.getByText(reactAnswer.answerMarkdown)).toBeVisible();
    expect(screen.getByLabelText("Editable solution")).toHaveValue(
      reactAnswer.code,
    );
    expect(screen.getByRole("button", { name: "Preview" })).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Draft generated. It has not been saved.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps the generated solution editable and saves the current draft", async () => {
    const user = userEvent.setup();
    const saved = {
      ...reactAnswer,
      id: "550e8400-e29b-41d4-a716-446655440000",
      question: "Build a counter",
      notes: "Use a functional update",
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z",
    };
    let answersRequested = 0;
    installFetch(async (path, init) => {
      if (path.endsWith("/playground-control"))
        return jsonResponse(emptySnapshot);
      if (path.endsWith("/generate")) return jsonResponse(reactAnswer);
      if (path.endsWith("/answers") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          question: "Build a counter",
          notes: "Use a functional update",
          code: `${reactAnswer.code}\n// edited`,
        });
        return jsonResponse(saved, 201);
      }
      if (path.endsWith("/answers")) {
        answersRequested += 1;
        return jsonResponse(answersRequested > 1 ? [saved] : []);
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();

    await user.type(
      screen.getByRole("textbox", { name: "Interview question" }),
      "Build a counter",
    );
    await user.click(screen.getByRole("button", { name: "Generate" }));
    await user.type(screen.getByLabelText("Editable solution"), "\n// edited");
    await user.type(
      screen.getByRole("textbox", { name: "Private notes" }),
      "Use a functional update",
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Saved", { selector: "span" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  });

  it("runs server-side code and exposes its result in the Output panel", async () => {
    const user = userEvent.setup();
    installFetch(async (path) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control")) {
        return jsonResponse({
          ...emptySnapshot,
          revision: 2,
          value: {
            ...emptySnapshot.value,
            question: "Print ok",
            language: "php",
            answer: phpAnswer,
          },
        });
      }
      if (path.endsWith("/run")) {
        return jsonResponse({
          stdout: "ok\n",
          stderr: "",
          exitCode: 0,
          durationMs: 12,
          timedOut: false,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();

    expect(
      await screen.findByRole("heading", { name: "Frequency Map" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Run" }));

    const output = await screen.findByText("ok");
    expect(output).toBeVisible();
    expect(screen.getByText("exit 0 · 12ms")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Run complete.");
  });

  it("builds a sandboxed React preview and neutralizes closing script tags", async () => {
    const user = userEvent.setup();
    installFetch(async (path) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control")) {
        return jsonResponse({
          ...emptySnapshot,
          revision: 3,
          value: {
            ...emptySnapshot.value,
            question: "Preview it",
            language: "react",
            answer: reactAnswer,
          },
        });
      }
      if (path.endsWith("/react-preview")) {
        return jsonResponse({ javascript: 'document.write("</script>")' });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();

    await user.click(await screen.findByRole("button", { name: "Preview" }));

    const frame = await screen.findByTitle("React solution preview");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain("<\\/script>");
  });

  it("opens a saved answer and clears it with New", async () => {
    const user = userEvent.setup();
    const saved = {
      ...phpAnswer,
      id: "550e8400-e29b-41d4-a716-446655440000",
      question: "Count values",
      notes: "Explain the invariant",
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z",
    };
    installFetch(async (path) => {
      if (path.endsWith("/answers")) return jsonResponse([saved]);
      if (path.endsWith("/playground-control"))
        return jsonResponse(emptySnapshot);
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();

    await user.click(screen.getByRole("button", { name: "Saved" }));
    const savedPanel = screen.getByRole("button", { name: /Frequency Map/ });
    await user.click(savedPanel);

    expect(
      screen.getByRole("textbox", { name: "Interview question" }),
    ).toHaveValue("Count values");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Opened “Frequency Map”.",
    );

    await user.click(screen.getByRole("button", { name: "New" }));
    expect(
      screen.getByRole("textbox", { name: "Interview question" }),
    ).toHaveValue("");
    expect(screen.getByText("Your answer will appear here.")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "New unsaved playground.",
    );
  });

  it("applies a newer external control revision to all visible fields", async () => {
    installFetch(async (path) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control")) {
        return jsonResponse({
          ...emptySnapshot,
          revision: 7,
          value: {
            question: "Build from the CLI",
            language: "react",
            answer: reactAnswer,
            notes: "Controlled externally",
            panel: "notes",
          },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();

    expect(
      await screen.findByRole("heading", { name: "Accessible Counter" }),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Interview question" }),
    ).toHaveValue("Build from the CLI");
    expect(screen.getByRole("textbox", { name: "Private notes" })).toHaveValue(
      "Controlled externally",
    );
    expect(screen.getByRole("status")).toHaveTextContent("revision 7");
  });

  it("shows API errors without losing the user's question", async () => {
    const user = userEvent.setup();
    installFetch(async (path) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control"))
        return jsonResponse(emptySnapshot);
      if (path.endsWith("/generate")) {
        return jsonResponse(
          { error: { message: "Provider unavailable" } },
          503,
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();

    const question = screen.getByRole("textbox", {
      name: "Interview question",
    });
    await user.type(question, "Keep this question");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Provider unavailable",
    );
    expect(question).toHaveValue("Keep this question");
  });
});
