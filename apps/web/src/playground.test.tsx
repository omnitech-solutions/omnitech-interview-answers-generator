import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Playground } from "./playground";

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
  usageCode: "// Render App",
  testCode: "expect(screen.getByRole('button')).toBeVisible();",
};

const phpAnswer = {
  title: "Frequency Map",
  language: "php",
  answerMarkdown: "Count each value in one pass.",
  code: "<?php echo 'ok';",
  usageCode: "echo 'usage';",
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
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
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
    expect(screen.getByRole("button", { name: "Run All" })).toBeDisabled();
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
    expect(screen.getByLabelText("Editable main solution")).toHaveValue(
      reactAnswer.code,
    );
    await user.click(screen.getByRole("tab", { name: "Usage / Output" }));
    expect(screen.getByLabelText("Editable usage and output")).toHaveValue(
      reactAnswer.usageCode,
    );
    await user.click(screen.getByRole("tab", { name: "Tests" }));
    expect(screen.getByLabelText("Editable tests")).toHaveValue(
      reactAnswer.testCode,
    );
    expect(screen.getByRole("button", { name: "Run All" })).toBeEnabled();
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
    await user.type(
      screen.getByLabelText("Editable main solution"),
      "\n// edited",
    );
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
          durationMs: 8,
          timedOut: false,
        });
      }
      if (path.endsWith("/run-all")) {
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
    await user.click(screen.getByRole("button", { name: "Run All" }));

    const output = await screen.findByText("ok");
    expect(output).toBeVisible();
    expect(screen.getByText("Passed · exit 0 · 8ms")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Run complete.");
  });

  it("checks the active editor syntax when it loses focus", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(async (path, init) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control")) {
        return jsonResponse({
          ...emptySnapshot,
          revision: 6,
          value: {
            ...emptySnapshot.value,
            question: "Check syntax",
            language: "php",
            answer: phpAnswer,
          },
        });
      }
      if (path.endsWith("/syntax-check")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          language: "php",
          code: phpAnswer.code,
        });
        return jsonResponse({
          stdout: "No syntax errors detected",
          stderr: "",
          exitCode: 0,
          durationMs: 4,
          timedOut: false,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();
    await screen.findByRole("heading", { name: "Frequency Map" });

    await user.click(screen.getByLabelText("Editable main solution"));
    await user.click(screen.getByRole("heading", { name: "Frequency Map" }));

    expect(await screen.findByText("Syntax valid")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/syntax-check",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("defaults word wrap off and caches the last chosen display mode", async () => {
    const user = userEvent.setup();
    installFetch(async (path) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control")) {
        return jsonResponse({
          ...emptySnapshot,
          revision: 5,
          value: {
            ...emptySnapshot.value,
            question: "Print output",
            language: "php",
            answer: phpAnswer,
          },
        });
      }
      if (path.endsWith("/run")) {
        return jsonResponse({
          stdout: "a very long output line that should remain scrollable",
          stderr: "",
          exitCode: 0,
          durationMs: 8,
          timedOut: false,
        });
      }
      if (path.endsWith("/run-all")) {
        return jsonResponse({
          stdout: "tests passed",
          stderr: "",
          exitCode: 0,
          durationMs: 10,
          timedOut: false,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();
    await user.click(await screen.findByRole("button", { name: "Run All" }));

    const toggle = await screen.findByRole("button", {
      name: "Toggle word wrap",
    });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveTextContent("Word wrap: Off");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveTextContent("Word wrap: On");
    expect(window.localStorage.getItem("interview-playground.word-wrap")).toBe(
      "true",
    );
    expect(screen.getByText(/a very long output line/)).toHaveClass(
      "output-wrap",
    );
  });

  it("runs the solution, usage, and tests together", async () => {
    const user = userEvent.setup();
    installFetch(async (path, init) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control")) {
        return jsonResponse({
          ...emptySnapshot,
          revision: 4,
          value: {
            ...emptySnapshot.value,
            question: "Test it",
            language: "php",
            answer: phpAnswer,
          },
        });
      }
      if (path.endsWith("/run")) {
        return jsonResponse({
          stdout: "okusage\n",
          stderr: "",
          exitCode: 0,
          durationMs: 10,
          timedOut: false,
        });
      }
      if (path.endsWith("/run-all")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          language: "php",
          code: "<?php echo 'ok';",
          usageCode: "echo 'usage';",
          testCode: "expect output ok",
          stdin: "",
        });
        return jsonResponse({
          stdout: "tests passed\n",
          stderr: "",
          exitCode: 0,
          durationMs: 18,
          timedOut: false,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();

    await screen.findByRole("heading", { name: "Frequency Map" });
    await user.click(screen.getByRole("button", { name: "Run All" }));

    expect(await screen.findByRole("button", { name: "Output" })).toHaveClass(
      "active",
    );
    expect(await screen.findByText("okusage")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Test results" }));
    expect(await screen.findByText("tests passed")).toBeVisible();
    expect(screen.queryByText("okusage")).not.toBeInTheDocument();
    expect(screen.getByText("Passed · exit 0 · 18ms")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Run complete.");
  });

  it("runs React through the Vitest endpoint and displays its real output", async () => {
    const user = userEvent.setup();
    installFetch(async (path, init) => {
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
      if (path.endsWith("/run")) {
        return jsonResponse({
          stdout: "compiled usage\n",
          stderr: "",
          exitCode: 0,
          durationMs: 20,
          timedOut: false,
        });
      }
      if (path.endsWith("/run-all")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          language: "react",
          code: reactAnswer.code,
          usageCode: reactAnswer.usageCode,
          testCode: reactAnswer.testCode,
        });
        return jsonResponse({
          stdout:
            "✓ solution.test.tsx > renders the counter\n\nTest Files  1 passed\nTests  1 passed\n",
          stderr: "",
          exitCode: 0,
          durationMs: 421,
          timedOut: false,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();

    await user.click(await screen.findByRole("button", { name: "Run All" }));

    await user.click(screen.getByRole("tab", { name: "Test results" }));
    expect(
      await screen.findByText(/solution\.test\.tsx > renders the counter/),
    ).toBeVisible();
    expect(screen.getByText("Passed · exit 0 · 421ms")).toBeVisible();
  });

  it("reruns the solution and usage when the Tests tab is empty", async () => {
    const user = userEvent.setup();
    installFetch(async (path, init) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control")) {
        return jsonResponse({
          ...emptySnapshot,
          revision: 5,
          value: {
            ...emptySnapshot.value,
            question: "Test it",
            language: "react",
            answer: reactAnswer,
          },
        });
      }
      if (path.endsWith("/run")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          language: "typescript",
          code: `${reactAnswer.code}\n\n${reactAnswer.usageCode}`,
        });
        return jsonResponse({
          stdout: "rendered usage\n",
          stderr: "",
          exitCode: 0,
          durationMs: 120,
          timedOut: false,
        });
      }
      if (path.endsWith("/run-all")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          language: "react",
          code: reactAnswer.code,
          usageCode: reactAnswer.usageCode,
          testCode: "",
        });
        return jsonResponse({
          stdout: "rendered usage\n",
          stderr: "",
          exitCode: 0,
          durationMs: 120,
          timedOut: false,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();

    await screen.findByRole("heading", { name: "Accessible Counter" });
    await user.click(screen.getByRole("tab", { name: "Tests" }));
    await user.clear(screen.getByLabelText("Editable tests"));

    expect(screen.getByRole("button", { name: "Run All" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Run All" }));
    expect(await screen.findByText("rendered usage")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Run complete.");
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
