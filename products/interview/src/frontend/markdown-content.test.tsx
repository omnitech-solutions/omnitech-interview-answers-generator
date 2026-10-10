import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { renderDiagram, initialize } = vi.hoisted(() => ({
  renderDiagram: vi.fn(),
  initialize: vi.fn(),
}));
const { panzoom, createPanzoom } = vi.hoisted(() => {
  const instance = {
    destroy: vi.fn(),
    reset: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomWithWheel: vi.fn(),
  };
  return { panzoom: instance, createPanzoom: vi.fn(() => instance) };
});

vi.mock("mermaid", () => ({
  default: {
    initialize,
    render: renderDiagram,
  },
}));
vi.mock("@panzoom/panzoom", () => ({
  default: createPanzoom,
}));

import { MarkdownContent } from "./markdown-content";

describe("MarkdownContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    document.documentElement.dataset["theme"] = "dark";
    renderDiagram.mockResolvedValue({
      svg: '<svg viewBox="0 0 10 10"><title>Flow</title></svg>',
    });
  });

  it("renders GFM and Mermaid fenced blocks as accessible diagrams", async () => {
    render(
      <MarkdownContent>
        {
          "| Item | Value |\n| --- | --- |\n| Cache | LRU |\n\n```mermaid\nflowchart LR\nA --> B\n```"
        }
      </MarkdownContent>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Rendering diagram");
    expect(await screen.findByLabelText("Workflow diagram")).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "strict",
        startOnLoad: false,
        theme: "dark",
      }),
    );
    expect(renderDiagram).toHaveBeenCalledWith(
      expect.stringMatching(/^mermaid-/),
      "flowchart LR\nA --> B",
    );
    await waitFor(() => expect(createPanzoom).toHaveBeenCalledOnce());
    expect(createPanzoom).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      expect.objectContaining({
        canvas: true,
        contain: "inside",
        startScale: 1,
        startX: 0,
        startY: 0,
      }),
    );
    expect(screen.getByLabelText("Diagram controls")).toHaveClass(
      "panzoom-exclude",
    );
    const parentPointerHandler = vi.fn();
    const canvas = screen.getByLabelText(
      "Interactive diagram. Drag to pan; pinch or hold Control or Command while scrolling to zoom.",
    );
    canvas.addEventListener("pointerdown", parentPointerHandler);
    fireEvent.pointerDown(screen.getByLabelText("Diagram controls"));
    expect(parentPointerHandler).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset diagram view" }));
    expect(panzoom.zoomIn).toHaveBeenCalledOnce();
    expect(panzoom.zoomOut).toHaveBeenCalledOnce();
    expect(panzoom.reset).toHaveBeenCalledWith({ animate: false });

    fireEvent.wheel(canvas, {
      ctrlKey: true,
      deltaY: -100,
    });
    expect(panzoom.zoomWithWheel).toHaveBeenCalledOnce();
    fireEvent.wheel(canvas, {
      deltaY: 100,
    });
    expect(panzoom.zoomWithWheel).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Show syntax" }));
    expect(screen.getByLabelText("Workflow diagram")).toHaveClass(
      "mermaid-diagram-split",
    );
    expect(
      within(
        screen.getByRole("figure", { name: "Workflow diagram" }),
      ).getByRole("code"),
    ).toHaveTextContent("flowchart LR");
    expect(
      within(
        screen.getByRole("figure", { name: "Workflow diagram" }),
      ).getByRole("code"),
    ).toHaveTextContent("A --> B");
    await waitFor(() =>
      expect(
        within(
          screen.getByRole("figure", { name: "Workflow diagram" }),
        ).getByRole("code").parentElement,
      ).toHaveAttribute("style"),
    );
    expect(
      within(screen.getByRole("figure", { name: "Workflow diagram" }))
        .getByRole("code")
        .querySelector("span[style]"),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy syntax" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "flowchart LR\nA --> B",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Syntax copied" }),
      ).toBeVisible(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide syntax" }));
    expect(screen.getByLabelText("Workflow diagram")).not.toHaveClass(
      "mermaid-diagram-split",
    );
    expect(
      within(
        screen.getByRole("figure", { name: "Workflow diagram" }),
      ).queryByRole("code"),
    ).toBeNull();

    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exitFullscreen,
    });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Toggle diagram fullscreen" }),
    );
    expect(requestFullscreen).toHaveBeenCalledOnce();
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: document.body,
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Toggle diagram fullscreen" }),
    );
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });

  it("preserves source and reports invalid Mermaid syntax", async () => {
    renderDiagram.mockRejectedValueOnce(new Error("Parse error"));
    render(
      <MarkdownContent>
        {"```mermaid\nthis is not a diagram\n```"}
      </MarkdownContent>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Parse error");
    expect(screen.getByText("this is not a diagram")).toBeVisible();
  });

  it("renders ordinary code without invoking Mermaid", async () => {
    render(<MarkdownContent>{"```ts\nconst value = 1;\n```"}</MarkdownContent>);
    expect(screen.getByText("const value = 1;")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "const value = 1;",
    );
    await screen.findByRole("button", { name: "Code copied" });
    await waitFor(() => expect(renderDiagram).not.toHaveBeenCalled());
  });

  it("highlights standalone code references with the collection language", async () => {
    render(
      <MarkdownContent defaultCodeLanguage="php">
        {
          "## Signature\n\n`array_map(?callable $callback, array $array): array`\n\nUse `array_map` for transforms."
        }
      </MarkdownContent>,
    );

    expect(
      screen.getByText("array_map(?callable $callback, array $array): array"),
    ).toBeVisible();
    expect(screen.getByText("php")).toBeVisible();
    expect(screen.getByText("array_map", { selector: "code" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Copy code" })).toHaveLength(
      1,
    );
  });

  it("emphasizes interview keywords without altering inline code", () => {
    render(
      <MarkdownContent keywords={["source state", "useRef"]}>
        {
          "Keep source state minimal and use `useRef` for mutable infrastructure."
        }
      </MarkdownContent>,
    );

    expect(screen.getByText("source state")).toHaveClass("markdown-keyword");
    const inlineCode = screen.getByText("useRef", { selector: "code" });
    expect(inlineCode).toHaveClass("markdown-inline-code");
    expect(inlineCode).not.toHaveClass("markdown-keyword");
  });

  it("marks bold answer labels separately from technical emphasis", () => {
    render(
      <MarkdownContent>
        {"- **Direct answer:** State updates trigger a **render**."}
      </MarkdownContent>,
    );

    expect(screen.getByText("Direct answer:")).toHaveClass(
      "markdown-answer-label",
    );
    expect(screen.getByText("render")).not.toHaveClass("markdown-answer-label");
  });

  it("renders stable linked headings and safe internal and external links", () => {
    render(
      <MarkdownContent>
        {
          "# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six\n\n[Internal](/library) [External](https://example.com)"
        }
      </MarkdownContent>,
    );
    expect(screen.getByRole("heading", { name: "Six" })).toHaveAttribute(
      "id",
      "six",
    );
    expect(screen.getByRole("link", { name: "Internal" })).not.toHaveAttribute(
      "target",
    );
    expect(screen.getByRole("link", { name: "External" })).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  it("destroys pan and zoom and removes its wheel listener when the diagram closes", async () => {
    const { unmount } = render(
      <MarkdownContent>
        {"```mermaid\nflowchart LR\nA --> B\n```"}
      </MarkdownContent>,
    );
    await screen.findByRole("figure", { name: "Workflow diagram" });
    await waitFor(() => expect(createPanzoom).toHaveBeenCalledOnce());
    const canvas = screen.getByLabelText(
      "Interactive diagram. Drag to pan; pinch or hold Control or Command while scrolling to zoom.",
    );
    unmount();
    expect(panzoom.destroy).toHaveBeenCalledTimes(1);
    fireEvent.wheel(canvas, { ctrlKey: true, deltaY: -100 });
    expect(panzoom.zoomWithWheel).not.toHaveBeenCalled();
  });

  it("drops a diagram rendered after its Markdown has changed", async () => {
    let release: (value: { svg: string }) => void = () => undefined;
    renderDiagram.mockImplementationOnce(
      () =>
        new Promise<{ svg: string }>((resolve) => {
          release = resolve;
        }),
    );
    const { rerender } = render(
      <MarkdownContent>
        {"```mermaid\nflowchart LR\nOld --> Diagram\n```"}
      </MarkdownContent>,
    );
    await waitFor(() => expect(renderDiagram).toHaveBeenCalledOnce());
    rerender(
      <MarkdownContent>
        {"```mermaid\nflowchart LR\nNew --> Diagram\n```"}
      </MarkdownContent>,
    );
    await screen.findByRole("figure", { name: "Workflow diagram" });
    await act(async () =>
      release({ svg: "<svg><title>Outdated diagram</title></svg>" }),
    );
    expect(screen.queryByText("Outdated diagram")).toBeNull();
    expect(screen.getByText("Flow")).toBeInTheDocument();
  });

  it("uses Mermaid's light theme when the studio is light", async () => {
    document.documentElement.dataset["theme"] = "light";
    render(
      <MarkdownContent>
        {"```mermaid\nflowchart LR\nA --> B\n```"}
      </MarkdownContent>,
    );
    await screen.findByLabelText("Workflow diagram");
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "default" }),
    );
  });
});
