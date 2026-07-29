import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const emptySnapshot = {
  revision: 0,
  updatedAt: "2026-07-24T00:00:00.000Z",
  value: {
    question: "",
    language: "auto",
    answer: null,
    notes: "",
    panel: "terminal",
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

async function renderSettled({ openInspector = true } = {}) {
  render(<Workspace />);
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  if (openInspector) {
    screen.queryByRole("button", { name: "Show inspector" })?.click();
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Inspector" })).toBeVisible(),
    );
  }
}

async function selectOpenAiProvider(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText("Answer provider"), "openai");
}

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

describe("Workspace", () => {
  it("keeps the briefing terminal open until its toggle or close button is used", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/?view=concept-lab");
    installFetch((path) => {
      if (path.endsWith("/explanations") || path.endsWith("/answers"))
        return jsonResponse([]);
      return jsonResponse({
        ...emptySnapshot,
        value: { ...emptySnapshot.value, view: "concept-lab" },
      });
    });
    await renderSettled({ openInspector: false });

    const toggle = screen.getByRole("button", { name: "Show terminal" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);

    const terminal = screen.getByRole("region", { name: "Terminal" });
    expect(terminal).toBeVisible();
    expect(
      screen.getByRole("dialog", { name: "Concept Inspector" }),
    ).toBeVisible();
    expect(terminal).toHaveClass("inspector-terminal-dock");
    expect(
      screen.getByRole("button", { name: "Hide terminal" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.selectOptions(
      screen.getByLabelText("Explanation provider"),
      "openai",
    );
    expect(terminal).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Close terminal" }));
    expect(
      screen.getByRole("button", { name: "Show terminal" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("dialog", { name: "Concept Inspector" }),
    ).toBeVisible();
    expect(terminal).toHaveClass("terminal-dock-hidden");
    expect(
      screen.getByRole("button", { name: "Hide inspector" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("starts as an accessible unsaved draft with unavailable actions", async () => {
    const user = userEvent.setup();
    installFetch();
    await renderSettled({ openInspector: false });

    expect(
      screen.getByRole("heading", { name: "Interview Studio" }),
    ).toBeVisible();
    expect(
      screen.getByRole("textbox", { name: "Interview question" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Answer provider")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Run All" })).toBeDisabled();
    expect(screen.queryByRole("dialog", { name: "Inspector" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show inspector" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Show inspector" }));
    expect(screen.getByRole("dialog", { name: "Inspector" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Terminal" })).toHaveClass(
      "terminal-dock-hidden",
    );
    const inspectorScroll = screen
      .getByRole("dialog", { name: "Inspector" })
      .querySelector(".inspector-scroll");
    expect(inspectorScroll).not.toBeNull();
    expect(inspectorScroll).toContainElement(
      screen.getByRole("region", { name: "Terminal" }),
    );
    expect(inspectorScroll?.children[0]).toHaveClass("inspector-main");
    expect(inspectorScroll?.children[1]).toBe(
      screen.getByRole("region", { name: "Terminal" }),
    );
    expect(screen.getByRole("button", { name: "Show terminal" })).toBeVisible();
    expect(
      screen.getByRole("region", { name: "Terminal" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show terminal" }));
    expect(screen.getByRole("region", { name: "Terminal" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Terminal" })).not.toHaveClass(
      "terminal-dock-hidden",
    );
    await user.click(screen.getByRole("button", { name: "Close terminal" }));
    const showTerminalButton = screen.getByRole("button", {
      name: "Show terminal",
    });
    expect(showTerminalButton).toBeVisible();
    expect(showTerminalButton).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Show terminal" }));
    await user.click(screen.getByRole("button", { name: "Notes" }));
    expect(
      screen.getByRole("textbox", { name: "Private notes" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Hide inspector" }));
    expect(screen.queryByRole("dialog", { name: "Inspector" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show terminal" }),
    ).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Show inspector" }));
    expect(screen.getByRole("dialog", { name: "Inspector" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Terminal" })).toHaveClass(
      "terminal-dock-hidden",
    );
    await user.click(screen.getByRole("button", { name: "Hide inspector" }));
    expect(screen.queryByRole("dialog", { name: "Inspector" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show inspector" }));
    expect(screen.getByRole("dialog", { name: "Inspector" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Terminal" })).toHaveClass(
      "terminal-dock-hidden",
    );
    await user.click(screen.getByRole("button", { name: "Dismiss drawer" }));
    expect(screen.queryByRole("dialog", { name: "Inspector" })).toBeNull();
  });

  it("enables Generate when the question is entered before the provider", async () => {
    const user = userEvent.setup();
    installFetch();
    await renderSettled({ openInspector: false });

    const generate = screen.getByRole("button", { name: "Generate" });
    await user.type(
      screen.getByRole("textbox", { name: "Interview question" }),
      "Format a newspaper page",
    );
    expect(generate).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Answer provider"), "codex");

    expect(generate).toBeEnabled();
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
            providerId: "openai",
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
    await selectOpenAiProvider(user);
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
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("starts Codex with the unchanged answer command in the inspector terminal", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(async (path, init) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control"))
        return jsonResponse(emptySnapshot);
      if (path.endsWith("/answer-sessions")) {
        expect(init).toMatchObject({
          method: "POST",
          body: JSON.stringify({ question: "Build a tested counter" }),
        });
        return jsonResponse(
          {
            name: "answer-abc",
            command: "/answer Build a tested counter",
          },
          201,
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled({ openInspector: false });

    await user.selectOptions(screen.getByLabelText("Answer provider"), "codex");
    await user.type(
      screen.getByRole("textbox", { name: "Interview question" }),
      "Build a tested counter",
    );
    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(
      await screen.findByText("tmux · answer-abc · project root"),
    ).toBeVisible();
    expect(screen.getByRole("region", { name: "Terminal" })).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      /\/answer result will populate the solution, usage, and tests/,
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/v1/generate",
      expect.anything(),
    );
  });

  it("keeps Generate for a new answer and uses + Apply change for refinement", async () => {
    const user = userEvent.setup();
    installFetch(async (path, init) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control"))
        return jsonResponse({
          revision: 1,
          updatedAt: "2026-07-28T00:00:00.000Z",
          value: {
            ...emptySnapshot.value,
            question: "Build a tested counter",
            language: "react",
            answer: reactAnswer,
          },
        });
      if (path.endsWith("/answer-sessions")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          question: "Build a tested counter",
          refinement: "Fix the failing boundary test",
          currentAnswer: {
            title: "Accessible Counter",
            code: reactAnswer.code,
          },
        });
        return jsonResponse(
          {
            name: "answer-refine",
            command: "/answer refine Fix the failing boundary test",
          },
          201,
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled({ openInspector: false });

    expect(
      await screen.findByRole("button", { name: "Generate" }),
    ).toBeVisible();
    const applyChange = await screen.findByRole("button", {
      name: "Apply change",
    });
    expect(applyChange).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Answer provider"), "codex");
    await user.type(
      screen.getByRole("textbox", { name: "Answer refinement" }),
      "Fix the failing boundary test",
    );
    await user.click(applyChange);

    expect(
      await screen.findByText("tmux · answer-refine · project root"),
    ).toBeVisible();
  });

  it("keeps the editable solution and offers an inline copy action", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    installFetch(async (path) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control"))
        return jsonResponse(emptySnapshot);
      if (path.endsWith("/generate")) return jsonResponse(reactAnswer);
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();
    await user.type(
      screen.getByRole("textbox", { name: "Interview question" }),
      "Build an accessible counter",
    );
    await user.selectOptions(screen.getByLabelText("Language"), "react");
    await selectOpenAiProvider(user);
    await user.click(screen.getByRole("button", { name: "Generate" }));

    await user.click(screen.getByRole("button", { name: "Copy code" }));
    expect(writeText).toHaveBeenCalledWith(reactAnswer.code);
    expect(screen.getByRole("status")).toHaveTextContent("Code copied.");

    expect(screen.getByLabelText("Editable main solution")).toHaveValue(
      reactAnswer.code,
    );
  });

  it("loads a realistic language template before sending it through generate", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(async (path, init) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control"))
        return jsonResponse(emptySnapshot);
      if (path.endsWith("/generate")) {
        const body = JSON.parse(String(init?.body));
        expect(body.language).toBe("ruby");
        expect(body.question).toContain("Sliding-Window Rate Limiter");
        return jsonResponse({
          ...reactAnswer,
          title: "Sliding Window Rate Limiter",
          language: "ruby",
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();

    await user.selectOptions(
      screen.getByLabelText("Example template"),
      "ruby-rate-limiter",
    );
    expect(screen.getByLabelText("Language")).toHaveValue("ruby");
    expect(
      (
        screen.getByRole("textbox", {
          name: "Interview question",
        }) as HTMLTextAreaElement
      ).value,
    ).toContain("Sliding-Window Rate Limiter");
    await selectOpenAiProvider(user);
    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(
      await screen.findByRole("heading", {
        name: "Sliding Window Rate Limiter",
      }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/generate",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("normalizes generated React tests for the Vitest runner", async () => {
    const user = userEvent.setup();
    installFetch(async (path, init) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control"))
        return jsonResponse(emptySnapshot);
      if (path.endsWith("/generate")) {
        return jsonResponse({
          ...reactAnswer,
          testCode:
            "import { render, screen } from '@testing-library/react';\nexpect(await screen.findByRole('link')).toHaveAttribute('href', '/items/cat');\nexpect(await screen.findByRole('alert')).toHaveTextContent('Search failed');",
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();
    await user.type(
      screen.getByRole("textbox", { name: "Interview question" }),
      "Build a search box",
    );
    await user.selectOptions(screen.getByLabelText("Language"), "react");
    await selectOpenAiProvider(user);
    await user.click(screen.getByRole("button", { name: "Generate" }));
    await user.click(await screen.findByRole("tab", { name: "Tests" }));

    const tests = screen.getByLabelText(
      "Editable tests",
    ) as HTMLTextAreaElement;
    expect(tests.value).toContain("afterEach(cleanup)");
    expect(tests.value).toContain("getAttribute('href')");
    expect(tests.value).toContain("textContent).toContain");
    expect(tests.value).not.toContain("toHaveAttribute");
    expect(tests.value).not.toContain("toHaveTextContent");
  });

  it("provides a PHP opening tag to the test editor for syntax highlighting", async () => {
    const user = userEvent.setup();
    installFetch();
    await renderSettled();

    await user.selectOptions(
      screen.getByLabelText("Example template"),
      "php-log-window",
    );
    await user.click(screen.getByRole("tab", { name: "Tests" }));

    expect(
      (screen.getByLabelText("Editable tests") as HTMLTextAreaElement).value,
    ).toMatch(/^<\?php\n/);
  });

  it("renders the question in a separate preview tab", async () => {
    const user = userEvent.setup();
    installFetch();
    await renderSettled();

    await user.selectOptions(
      screen.getByLabelText("Example template"),
      "typescript-dependency-order",
    );
    await user.click(screen.getByRole("tab", { name: "Rendered preview" }));

    expect(screen.getByText(/# Dependency Order/)).toBeVisible();
    expect(screen.getByRole("tab", { name: "Question input" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
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
    await selectOpenAiProvider(user);
    await user.click(screen.getByRole("button", { name: "Generate" }));
    await user.click(screen.getByRole("button", { name: "Notes" }));
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

  it("copies the active normal output or test results panel", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
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
          stdout: "solution output\n",
          stderr: "",
          exitCode: 0,
          durationMs: 8,
          timedOut: false,
        });
      }
      if (path.endsWith("/run-all")) {
        return jsonResponse({
          stdout: "test output\n",
          stderr: "",
          exitCode: 0,
          durationMs: 12,
          timedOut: false,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();
    await user.click(screen.getByRole("button", { name: "Run All" }));

    await screen.findByText("solution output");
    await user.click(
      screen.getByRole("button", { name: "Copy normal output" }),
    );
    expect(writeText).toHaveBeenCalledWith("solution output\n");

    await user.click(screen.getByRole("tab", { name: "Test results" }));
    await screen.findByText("test output");
    await user.click(screen.getByRole("button", { name: "Copy test results" }));
    expect(writeText).toHaveBeenCalledWith("test output\n");
  });

  it("shows the empty output state before an answer has run", async () => {
    const user = userEvent.setup();
    installFetch();
    await renderSettled();
    await user.click(screen.getByRole("button", { name: "Output" }));

    expect(screen.getByText("Run a solution to see its output.")).toBeVisible();
  });

  it("shows failed output and reports clipboard permission errors", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    installFetch(async (path) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control")) {
        return jsonResponse({
          ...emptySnapshot,
          revision: 8,
          value: { ...emptySnapshot.value, language: "php", answer: phpAnswer },
        });
      }
      if (path.endsWith("/run")) {
        return jsonResponse({
          stdout: "",
          stderr: "failed output",
          exitCode: 1,
          durationMs: 10,
          timedOut: false,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();
    await user.click(screen.getByRole("button", { name: "Run All" }));
    expect(await screen.findByText("Failed · exit 1 · 10ms")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Copy normal output" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Couldn’t copy output",
    );
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

    expect(await screen.findByText("Syntax looks good")).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/syntax-check",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("shows the native syntax checker output", async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch(async (path, init) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control")) {
        return jsonResponse({
          ...emptySnapshot,
          revision: 7,
          value: {
            ...emptySnapshot.value,
            question: "Find the syntax issue",
            language: "ruby",
            answer: {
              ...phpAnswer,
              title: "Broken Ruby",
              language: "ruby",
              code: "def solution(value)\n  value\nend",
            },
          },
        });
      }
      if (path.endsWith("/syntax-check")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          language: "ruby",
          code: "def solution(value)\n  value\nend",
        });
        return jsonResponse({
          stdout:
            "ruby: /workspace/solution.rb:2: syntax error found (SyntaxError)\n> 2 |   value\n    |   ^ unexpected local variable",
          stderr: "",
          exitCode: 1,
          durationMs: 4,
          timedOut: false,
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();
    await screen.findByRole("heading", { name: "Broken Ruby" });

    await user.click(screen.getByLabelText("Editable main solution"));
    await user.click(screen.getByRole("heading", { name: "Broken Ruby" }));

    expect(
      await screen.findByLabelText("Syntax checker output"),
    ).toHaveTextContent(
      "ruby: /workspace/solution.rb:2: syntax error found (SyntaxError)",
    );
    expect(screen.getByText(/unexpected local variable/)).toBeVisible();
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
    await user.click(screen.getByRole("tab", { name: "Normal output" }));
    expect(await screen.findByText("okusage")).toBeVisible();
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

  it("renders a React preview panel below the main solution", async () => {
    installFetch(async (path, init) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control")) {
        return jsonResponse({
          ...emptySnapshot,
          revision: 4,
          value: {
            ...emptySnapshot.value,
            language: "react",
            answer: reactAnswer,
          },
        });
      }
      if (path.endsWith("/react-preview")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          code: reactAnswer.code,
          componentName: "App",
        });
        return jsonResponse({
          javascript: "document.body.dataset.preview = 'ready';",
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();

    expect(
      await screen.findByRole("region", { name: "React rendered preview" }),
    ).toBeVisible();
    expect(screen.getByTitle("Rendered React component")).toHaveAttribute(
      "sandbox",
      "allow-scripts",
    );
    expect(screen.getByText("Live")).toBeVisible();
  });

  it("shows a useful error when the React preview cannot compile", async () => {
    installFetch(async (path) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control")) {
        return jsonResponse({
          ...emptySnapshot,
          revision: 6,
          value: {
            ...emptySnapshot.value,
            language: "react",
            answer: reactAnswer,
          },
        });
      }
      if (path.endsWith("/react-preview")) {
        return jsonResponse(
          { error: { message: "React compilation failed." } },
          400,
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();

    expect(await screen.findByText("React compilation failed.")).toBeVisible();
    expect(
      screen.queryByTitle("Rendered React component"),
    ).not.toBeInTheDocument();
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
    let resetPatch: Record<string, unknown> | undefined;
    installFetch(async (path, init) => {
      if (path.endsWith("/answers")) return jsonResponse([saved]);
      if (path.endsWith("/playground-control") && init?.method === "PATCH") {
        resetPatch = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonResponse({
          revision: 1,
          updatedAt: "2026-07-28T00:00:00.000Z",
          value: {
            ...emptySnapshot.value,
            explanation: {
              topic: "React",
              title: "React",
              markdown: "Preserved concept.",
            },
          },
        });
      }
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
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "New unsaved workspace.",
      ),
    );
    expect(resetPatch).toEqual({
      view: "playground",
      question: "",
      language: "auto",
      answer: null,
      notes: "",
      panel: "output",
    });
  });

  it("paginates and deletes saved answers", async () => {
    const user = userEvent.setup();
    let savedAnswers = Array.from({ length: 6 }, (_, index) => ({
      ...phpAnswer,
      id: `550e8400-e29b-41d4-a716-44665544000${index}`,
      title: `Frequency Map ${index + 1}`,
      question: `Count values ${index + 1}`,
      notes: "",
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z",
    }));
    installFetch(async (path, init) => {
      if (path.endsWith("/answers")) return jsonResponse(savedAnswers);
      if (path.endsWith("/playground-control"))
        return jsonResponse(emptySnapshot);
      if (path.includes("/answers/") && init?.method === "DELETE") {
        savedAnswers = savedAnswers.slice(1);
        return jsonResponse({ deleted: true });
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();
    await user.click(screen.getByRole("button", { name: "Saved" }));

    expect(screen.getByText("Page 1 of 2")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Frequency Map 1/ }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 2 of 2")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Frequency Map 6/ }),
    ).toBeVisible();
    await user.click(
      screen.getAllByRole("button", { name: "Delete saved answer" }).at(-1)!,
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Deleted.");
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
    await selectOpenAiProvider(user);
    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Provider unavailable",
    );
    expect(question).toHaveValue("Keep this question");
  });

  it("persists the selected theme", async () => {
    const user = userEvent.setup();
    installFetch(async (path) => {
      if (path.endsWith("/answers")) return jsonResponse([]);
      if (path.endsWith("/playground-control"))
        return jsonResponse(emptySnapshot);
      throw new Error(`Unexpected request: ${path}`);
    });
    await renderSettled();

    await user.click(
      screen.getByRole("button", { name: "Switch to dark theme" }),
    );

    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(window.localStorage.getItem("interview-playground.theme")).toBe(
      "dark",
    );
    expect(
      screen.getByRole("button", { name: "Switch to light theme" }),
    ).toBeVisible();
  });
});
