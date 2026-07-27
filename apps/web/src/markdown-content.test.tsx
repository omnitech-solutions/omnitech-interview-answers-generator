import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    const { container } = render(
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
    container
      .querySelector(".mermaid-canvas")
      ?.addEventListener("pointerdown", parentPointerHandler);
    fireEvent.pointerDown(screen.getByLabelText("Diagram controls"));
    expect(parentPointerHandler).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset diagram view" }));
    expect(panzoom.zoomIn).toHaveBeenCalledOnce();
    expect(panzoom.zoomOut).toHaveBeenCalledOnce();
    expect(panzoom.reset).toHaveBeenCalledWith({ animate: false });

    fireEvent.wheel(container.querySelector(".mermaid-canvas") as Element, {
      ctrlKey: true,
      deltaY: -100,
    });
    expect(panzoom.zoomWithWheel).toHaveBeenCalledOnce();
    fireEvent.wheel(container.querySelector(".mermaid-canvas") as Element, {
      deltaY: 100,
    });
    expect(panzoom.zoomWithWheel).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Show syntax" }));
    expect(screen.getByLabelText("Workflow diagram")).toHaveClass(
      "mermaid-diagram-split",
    );
    expect(container.querySelector(".mermaid-source code")).toHaveTextContent(
      "flowchart LR",
    );
    expect(container.querySelector(".mermaid-source code")).toHaveTextContent(
      "A --> B",
    );
    expect(container.querySelector(".mermaid-source .token")).not.toBeNull();
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
    expect(container.querySelector(".mermaid-source")).toBeNull();

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
    await waitFor(() => expect(renderDiagram).not.toHaveBeenCalled());
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
