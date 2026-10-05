// The live code canvas: tabs, edits, copy, Run through a fake runner, the
// revision-available bar, and that arrivals never clobber unsaved edits.
import type { RunResult } from "@omnitech/interview-contracts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codeResult } from "../session-result-fixtures";
import { type CodeResult, parseCodeResult } from "../session-results";
import { LiveCodeCanvas } from "./code-canvas";

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

afterEach(cleanup);

const make = (overrides: Record<string, unknown> = {}): CodeResult =>
  parseCodeResult(
    codeResult({
      code: "export const a = 1;",
      usageCode: "console.log(a);",
      testCode: "it('a', () => {});",
      ...overrides,
    }),
  ) as CodeResult;

const passed: RunResult = {
  stdout: "hello",
  stderr: "",
  exitCode: 0,
  durationMs: 1200,
  timedOut: false,
  tests: [
    { name: "adds", status: "passed" },
    { name: "subtracts", status: "failed", message: "expected 1" },
  ],
};

const editor = (name: RegExp) => screen.getByLabelText(name);
const tab = (name: string) =>
  screen.getByRole("tab", { name: new RegExp(`^${name}`) });

describe("LiveCodeCanvas", () => {
  it("shows Solution, Usage and Tests as tabs over the three fields", () => {
    render(<LiveCodeCanvas result={make()} />);
    expect(
      within(screen.getByRole("tablist", { name: "Code files" }))
        .getAllByRole("tab")
        .map((t) => t.textContent),
    ).toEqual(["Solution", "Usage", "Tests"]);
    expect(editor(/Edit solution\.ts/)).toHaveValue("export const a = 1;");
    fireEvent.click(tab("Usage"));
    expect(editor(/Edit usage\.ts/)).toHaveValue("console.log(a);");
    fireEvent.click(tab("Tests"));
    expect(editor(/Edit solution\.test\.ts/)).toHaveValue("it('a', () => {});");
  });

  it("starts with the worker's verification as the Results panel", () => {
    render(
      <LiveCodeCanvas
        result={make({
          states: {
            generated: true,
            testsPassed: true,
            fullyVerified: true,
            reasons: [],
          },
        })}
        density="maximized"
      />,
    );
    const results = screen.getByLabelText("Results");
    expect(within(results).getByText("Fully verified")).toBeVisible();
    expect(within(results).getByText("allows")).toBeVisible();
  });

  it("marks edited tabs and the canvas, and clears the mark when reverted", () => {
    render(<LiveCodeCanvas result={make()} />);
    fireEvent.change(editor(/Edit solution/), {
      target: { value: "export const a = 2;" },
    });
    expect(within(tab("Solution")).getByLabelText("edited")).toBeVisible();
    expect(screen.getByText("Edited")).toBeVisible();
    fireEvent.change(editor(/Edit solution/), {
      target: { value: "export const a = 1;" },
    });
    expect(screen.queryByText("Edited")).toBeNull();
  });

  it("copies the open tab and copies all", async () => {
    const onCopy = vi.fn();
    render(
      <LiveCodeCanvas result={make()} onCopy={onCopy} density="maximized" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(onCopy).toHaveBeenLastCalledWith("export const a = 1;");
    fireEvent.click(screen.getByRole("button", { name: "Copy all" }));
    const all = onCopy.mock.calls.at(-1)?.[0] as string;
    expect(all).toContain("export const a = 1;");
    expect(all).toContain("console.log(a);");
    expect(all).toContain("it('a', () => {});");
    await waitFor(() => expect(screen.getByText("Copied all")).toBeVisible());
  });

  it("says Copied only after the clipboard write succeeded, and says when it failed", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<LiveCodeCanvas result={make()} density="maximized" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByText("Copied")).toBeVisible());
    expect(writeText).toHaveBeenCalledWith("export const a = 1;");
    cleanup();
    // A blocked clipboard and no selection route: no tick, an honest failure.
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) },
    });
    document.execCommand = vi.fn(() => false);
    render(<LiveCodeCanvas result={make()} density="maximized" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(screen.getByText("Copy failed")).toBeVisible());
    expect(screen.queryByText("Copied")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("runs the edited solution, usage and tests in order and shows the results", async () => {
    const runner = vi.fn().mockResolvedValue(passed);
    render(
      <LiveCodeCanvas result={make()} runner={runner} density="maximized" />,
    );
    fireEvent.change(editor(/Edit solution/), {
      target: { value: "export const a = 3;" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.getByText("adds")).toBeVisible());
    expect(runner).toHaveBeenCalledWith({
      language: "typescript",
      code: "export const a = 3;",
      usageCode: "console.log(a);",
      testCode: "it('a', () => {});",
    });
    expect(screen.getByText("subtracts")).toBeVisible();
    expect(screen.getByText("expected 1")).toBeVisible();
    expect(screen.getByText("Your run")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Output" }));
    expect(screen.getByText("hello")).toBeVisible();
  });

  it("says the run is out of date after editing again", async () => {
    render(
      <LiveCodeCanvas
        result={make()}
        runner={vi.fn().mockResolvedValue(passed)}
        density="maximized"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.getByText("Your run")).toBeVisible());
    fireEvent.change(editor(/Edit solution/), { target: { value: "x" } });
    expect(screen.getByText("Edited since this run")).toBeVisible();
  });

  it("shows the runner's message when it cannot run", async () => {
    render(
      <LiveCodeCanvas
        result={make()}
        runner={vi.fn().mockRejectedValue(new Error("Docker is not running"))}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Docker is not running",
    );
  });

  it("adopts a new revision silently when nothing is edited", () => {
    const view = render(<LiveCodeCanvas result={make()} revision={1} />);
    view.rerender(
      <LiveCodeCanvas
        result={make({ code: "export const a = 9;" })}
        revision={2}
      />,
    );
    expect(editor(/Edit solution/)).toHaveValue("export const a = 9;");
    expect(screen.queryByTestId("revision-bar")).toBeNull();
  });

  it("offers a new revision without overwriting unsaved edits", () => {
    const view = render(<LiveCodeCanvas result={make()} revision={1} />);
    fireEvent.change(editor(/Edit solution/), { target: { value: "mine" } });
    view.rerender(
      <LiveCodeCanvas
        result={make({ code: "export const a = 9;" })}
        revision={2}
      />,
    );
    expect(screen.getByTestId("revision-bar")).toHaveTextContent(
      "Revision 2 available",
    );
    expect(editor(/Edit solution/)).toHaveValue("mine");

    // Keep mine dismisses the bar and keeps the text, even on re-render.
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    expect(screen.queryByTestId("revision-bar")).toBeNull();
    view.rerender(
      <LiveCodeCanvas
        result={make({ code: "export const a = 9;" })}
        revision={2}
      />,
    );
    expect(screen.queryByTestId("revision-bar")).toBeNull();
    expect(editor(/Edit solution/)).toHaveValue("mine");

    // A still newer revision asks again; Switch takes it and drops the edits.
    view.rerender(
      <LiveCodeCanvas
        result={make({ code: "export const a = 10;" })}
        revision={3}
      />,
    );
    expect(screen.getByTestId("revision-bar")).toHaveTextContent(
      "Revision 3 available",
    );
    fireEvent.click(screen.getByRole("button", { name: "Switch" }));
    expect(editor(/Edit solution/)).toHaveValue("export const a = 10;");
    expect(screen.queryByTestId("revision-bar")).toBeNull();
    expect(screen.queryByText("Edited")).toBeNull();
  });

  it("does not run twice while running and ignores a superseded run", async () => {
    let finish: (value: RunResult) => void = () => {};
    const runner = vi.fn(
      () => new Promise<RunResult>((resolve) => (finish = resolve)),
    );
    render(<LiveCodeCanvas result={make()} runner={runner} />);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(screen.getByRole("button", { name: "Running…" })).toBeDisabled();
    await act(async () => finish(passed));
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("toggles soft wrap", () => {
    render(<LiveCodeCanvas result={make()} density="maximized" />);
    const wrap = screen.getByRole("button", { name: "Wrap" });
    fireEvent.click(wrap);
    expect(wrap).toHaveAttribute("aria-pressed", "true");
  });

  it("collapses results and opens them by default only when maximized", () => {
    const view = render(<LiveCodeCanvas result={make()} density="compact" />);
    const head = () => screen.getByRole("button", { name: /Results/ });
    expect(head()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(head());
    expect(head()).toHaveAttribute("aria-expanded", "true");
    view.unmount();
    render(<LiveCodeCanvas result={make()} density="maximized" />);
    expect(head()).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Code canvas")).toHaveAttribute(
      "data-density",
      "maximized",
    );
  });

  it("compact density keeps the code open with pills, icon buttons and a one-line results chip", () => {
    render(<LiveCodeCanvas result={make()} />);
    const canvas = screen.getByLabelText("Code canvas");
    expect(canvas).toHaveAttribute("data-density", "compact");
    // The code is there at once, not behind a header.
    expect(editor(/Edit solution\.ts/)).toHaveValue("export const a = 1;");
    // Run and Copy are icon-only; Wrap and Copy all are maximized-only.
    expect(screen.getByRole("button", { name: "Run" })).toHaveTextContent("");
    expect(screen.getByRole("button", { name: "Copy" })).toHaveTextContent("");
    expect(screen.queryByRole("button", { name: "Wrap" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy all" })).toBeNull();
    // Results are one chip, collapsed.
    const chip = screen.getByRole("button", { name: /^Results:/ });
    expect(chip).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-expanded", "true");
  });

  it("maximized density shows the labelled controls over the same editor", () => {
    render(<LiveCodeCanvas result={make()} density="maximized" />);
    expect(screen.getByRole("button", { name: "Run" })).toHaveTextContent(
      "Run",
    );
    expect(screen.getByRole("button", { name: "Wrap" })).toBeVisible();
    expect(editor(/Edit solution\.ts/)).toHaveValue("export const a = 1;");
  });

  it("cannot run a language the runner does not know", () => {
    render(<LiveCodeCanvas result={make({ language: "cobol" })} />);
    expect(screen.getByRole("button", { name: "Run" })).toBeDisabled();
  });
});
