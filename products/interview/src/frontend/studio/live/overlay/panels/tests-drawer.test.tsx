// The Tests drawer on the code card: the handle and its state, what it keeps per
// viewer, what is read inside it, and the line links into the Tests and Solution
// tabs.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardCode } from "../../shared/task-card-model";
import { CodeCard } from "./code-card";
import { TESTS_DRAWER_STORAGE_KEY } from "./tests-drawer-pref";

const constraints = [
  {
    text: "At most 5 calls per second",
    status: "current",
    sinceRevision: 1,
    supersededAtRevision: null,
  },
] as const;
const SOLUTION = "const a = 1;\nconst b = 2;\nconst c = 3;";
const TESTS =
  "it('one', () => {});\nit('two', () => {});\nit('three', () => {});";
const USAGE = "allow('a');";
const withUsage: CardCode["files"] = [
  { id: "solution", name: "solution.ts", text: SOLUTION },
  { id: "usage", name: "usage.ts", text: USAGE },
];
const withUsageAndTests: CardCode["files"] = [
  ...withUsage,
  { id: "tests", name: "tests.ts", text: TESTS },
];
const oneFailure = (
  failure: Partial<NonNullable<CardCode["tests"]>["results"][number]>,
): NonNullable<CardCode["tests"]> => ({
  generated: true,
  total: 1,
  passed: 0,
  failed: 1,
  skipped: 0,
  results: [{ name: "rejects", status: "failed", ...failure }],
});

function code(overrides: Partial<CardCode> = {}): CardCode {
  return {
    language: "typescript",
    text: SOLUTION,
    revision: 1,
    files: [
      { id: "solution", name: "solution.ts", text: SOLUTION },
      { id: "tests", name: "tests.ts", text: TESTS },
    ],
    tests: {
      generated: true,
      total: 6,
      passed: 5,
      failed: 1,
      skipped: 0,
      results: [
        { name: "allows", status: "passed", covers: [0] },
        {
          name: "rejects",
          status: "failed",
          message: "expected 429",
          location: { editor: "tests", line: 2 },
        },
      ],
    },
    reasons: ["A test failed."],
    syntax: { checked: true, clean: true },
    diagnostics: [],
    repair: { attempted: false, succeeded: false },
    notes: "",
    ...overrides,
  };
}

function card(overrides: Partial<CardCode> = {}) {
  const onCopy = vi.fn();
  render(
    <CodeCard
      code={code(overrides)}
      constraints={constraints}
      badges={[]}
      copy={{ label: "Copy code", copied: false, onCopy }}
    />,
  );
  return { onCopy };
}
const solutionTab = () => screen.getByRole("button", { name: "solution.ts" });
const testsTab = () => screen.getByRole("button", { name: "tests.ts" });
const handle = () => screen.getByRole("button", { name: "Tests" });
const drawer = () => screen.getByTestId("pn-tests-drawer");
const lines = (selector: string) =>
  [...document.querySelectorAll(selector)].map((line) => line.textContent);

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the handle", () => {
  it("starts closed, shows |>|, and toggles with |<| and aria-expanded", () => {
    card();
    expect(handle()).toHaveAttribute("aria-expanded", "false");
    expect(handle()).toHaveAttribute("aria-controls", drawer().id);
    expect(handle()).toHaveTextContent("|>|");
    expect(handle()).toHaveAttribute("title", "Show generated tests");
    fireEvent.click(handle());
    expect(handle()).toHaveAttribute("aria-expanded", "true");
    expect(handle()).toHaveTextContent("|<|");
    expect(drawer()).toBeVisible();
    expect(drawer()).toHaveAttribute("data-open", "true");
    fireEvent.click(handle());
    expect(drawer()).not.toBeVisible();
  });

  it("opens and closes with Enter and Space from the keyboard", async () => {
    const user = userEvent.setup();
    card();
    handle().focus();
    await user.keyboard("{Enter}");
    expect(handle()).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(handle()).toHaveAttribute("aria-expanded", "false");
  });

  it("is a labelled complementary region with the counts in its name", () => {
    card();
    fireEvent.click(handle());
    const region = screen.getByRole("complementary", {
      name: "Generated tests",
    });
    expect(within(region).getByLabelText("Tests: 5 of 6 passed")).toBeVisible();
  });
});

describe("what is kept per viewer", () => {
  it("remembers open across a remount and reads it in the first render", () => {
    card();
    fireEvent.click(handle());
    expect(window.localStorage.getItem(TESTS_DRAWER_STORAGE_KEY)).toBe("open");
    cleanup();
    card();
    expect(handle()).toHaveAttribute("aria-expanded", "true");
    expect(drawer()).toBeVisible();
  });

  it("follows another window through the storage event", () => {
    card();
    window.localStorage.setItem(TESTS_DRAWER_STORAGE_KEY, "open");
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: TESTS_DRAWER_STORAGE_KEY }),
      );
    });
    expect(handle()).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the choice in memory when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    card();
    expect(handle()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(handle());
    expect(handle()).toHaveAttribute("aria-expanded", "true");
    expect(drawer()).toBeVisible();
  });
});

describe("closed", () => {
  it("is inert, hidden from assistive technology, and holds nothing to tab to", () => {
    card();
    expect(drawer()).toHaveAttribute("inert");
    expect(drawer()).toHaveAttribute("aria-hidden", "true");
    expect(drawer().querySelector("button, a, input, [tabindex]")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy tests" })).toBeNull();
    expect(screen.queryByTestId("pn-tests-honesty")).toBeNull();
  });
});

describe("the open drawer", () => {
  beforeEach(() =>
    window.localStorage.setItem(TESTS_DRAWER_STORAGE_KEY, "open"),
  );

  it("reads counts, the honesty line, the reasons, the rows and the source in that order", () => {
    card();
    const order = [
      ...drawer().querySelectorAll(
        "[aria-label='Tests: 5 of 6 passed'], [data-testid='pn-tests-honesty'], [data-testid='pn-tests-notverified'], [aria-label='Test results']",
      ),
    ].map(
      (node) =>
        node.getAttribute("aria-label") ?? node.getAttribute("data-testid"),
    );
    expect(order).toEqual([
      "Tests: 5 of 6 passed",
      "pn-tests-honesty",
      "pn-tests-notverified",
      "Test results",
    ]);
    // The test source is the Tests tab now: no second copy lives in the drawer.
    expect(drawer().querySelector(".cm-editor")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy tests" })).toBeNull();
    expect(screen.getByTestId("pn-tests-honesty")).toHaveTextContent(
      "Generated tests passing is not full verification.",
    );
    expect(screen.getByTestId("pn-tests-notverified")).toHaveTextContent(
      "Not fully verified: A test failed.",
    );
    const [allows, rejects] = screen.getAllByTestId("pn-test");
    expect(allows).toHaveTextContent("allows");
    expect(allows).toHaveTextContent("covers: At most 5 calls per second");
    expect(rejects).toHaveTextContent("expected 429");
  });

  it("a failed test's link switches to the Tests tab and marks the failing line", () => {
    card();
    expect(testsTab()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(
      screen.getByRole("button", { name: "Go to line 2 (tests)" }),
    );
    expect(testsTab()).toHaveAttribute("aria-pressed", "true");
    expect(solutionTab()).toHaveAttribute("aria-pressed", "false");
    expect(lines(".pn-codemain .cm-editor .cm-line")).toEqual(
      TESTS.split("\n"),
    );
    expect(lines(".pn-codemain .cm-editor .pn-line-hit")).toEqual([
      "it('two', () => {});",
    ]);
  });

  it("a failure in the solution goes back to the Solution tab line from the Tests tab", () => {
    card({
      tests: {
        ...oneFailure({
          message: "boom",
          location: { editor: "solution", line: 3 },
        }),
      },
    });
    fireEvent.click(testsTab());
    expect(lines(".pn-codemain .cm-editor .pn-line-hit")).toEqual([]);
    fireEvent.click(
      screen.getByRole("button", { name: "Go to line 3 (solution)" }),
    );
    expect(solutionTab()).toHaveAttribute("aria-pressed", "true");
    expect(lines(".pn-codemain .cm-editor .pn-line-hit")).toEqual([
      "const c = 3;",
    ]);
  });

  it("a line mark belongs to its own file and is gone from the others", () => {
    card({ files: withUsageAndTests });
    fireEvent.click(
      screen.getByRole("button", { name: "Go to line 2 (tests)" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "usage.ts" }));
    expect(lines(".pn-codemain .cm-editor .pn-line-hit")).toEqual([]);
  });

  it("says details are not available when a failure has no message or location", () => {
    card({ tests: oneFailure({}) });
    expect(screen.getByText("Failure details not available")).toBeVisible();
  });

  it("states the unavailable cases in the app's own words", () => {
    card({
      tests: null,
      files: [{ id: "solution", name: "solution.ts", text: SOLUTION }],
    });
    expect(screen.getByTestId("pn-tests-unavailable")).toHaveTextContent(
      "The code runner was not available, so no test result is claimed.",
    );
    expect(screen.getByTestId("pn-tests-nosource")).toHaveTextContent(
      "No test source was published.",
    );
  });

  it("has no Run control anywhere on the card", () => {
    card();
    expect(screen.queryByRole("button", { name: /run/i })).toBeNull();
  });
});

describe("the code card", () => {
  it("offers Solution and Usage with the real file names and switches the shown file", () => {
    card({ files: withUsage });
    expect(screen.getByRole("button", { name: "solution.ts" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "usage.ts" }));
    expect(screen.getByRole("button", { name: "usage.ts" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(lines(".pn-codemain .cm-editor .cm-line")).toEqual([USAGE]);
  });

  it("offers Solution, Usage and Tests tabs, each named and showing its own file", () => {
    card({ files: withUsageAndTests });
    const tabs = within(
      screen.getByRole("group", { name: "File" }),
    ).getAllByRole("button");
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "solution.ts",
      "usage.ts",
      "tests.ts",
    ]);
    fireEvent.click(testsTab());
    expect(testsTab()).toHaveAttribute("aria-pressed", "true");
    expect(solutionTab()).toHaveAttribute("aria-pressed", "false");
    expect(lines(".pn-codemain .cm-editor .cm-line")).toEqual(
      TESTS.split("\n"),
    );
  });

  it("copies the test source from the Tests tab", () => {
    const { onCopy } = card();
    fireEvent.click(testsTab());
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(onCopy).toHaveBeenCalledWith(TESTS);
  });

  it("copies the file on show", () => {
    const { onCopy } = card({ files: withUsage });
    fireEvent.click(screen.getByRole("button", { name: "usage.ts" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    expect(onCopy).toHaveBeenCalledWith(USAGE);
  });

  it("draws no tab row when only the solution was published", () => {
    card({ files: [{ id: "solution", name: "solution.ts", text: SOLUTION }] });
    expect(screen.queryByRole("group", { name: "File" })).toBeNull();
  });

  it("lists syntax problems and a problem's line link highlights the solution line, from Usage too", () => {
    card({
      files: withUsage,
      diagnostics: [{ line: 2, column: 5, message: "Unexpected token" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "usage.ts" }));
    const problems = within(screen.getByRole("region", { name: "Problems" }));
    expect(problems.getByText(/Unexpected token/)).toBeVisible();
    fireEvent.click(problems.getByRole("button", { name: "Line 2:5" }));
    expect(screen.getByRole("button", { name: "solution.ts" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(lines(".pn-codemain .cm-editor .pn-line-hit")).toEqual([
      "const b = 2;",
    ]);
  });

  it("draws no Problems list when there are none", () => {
    card();
    expect(screen.queryByRole("region", { name: "Problems" })).toBeNull();
  });

  it("says a repair fixed it, or only that one was attempted, and keeps the approach note collapsed", () => {
    card({
      repair: { attempted: true, succeeded: true },
      notes: "A sliding window.",
    });
    expect(screen.getByTestId("pn-code-repair")).toHaveTextContent(
      "Fixed after a repair",
    );
    const note = screen.getByText("Approach note").closest("details");
    expect(note).not.toHaveAttribute("open");
    expect(note).toHaveTextContent("A sliding window.");
    cleanup();
    card({ repair: { attempted: true, succeeded: false } });
    expect(screen.getByTestId("pn-code-repair")).toHaveTextContent(
      "Repair attempted",
    );
    expect(screen.queryByText("Approach note")).toBeNull();
  });

  it("shows the reasons inline under Not fully verified", () => {
    card();
    expect(screen.getByTestId("pn-code-reasons")).toHaveTextContent(
      "Not fully verified: A test failed.",
    );
  });
});

describe("clear glass", () => {
  const css = readFileSync(join(__dirname, "panels.css"), "utf8");
  it("keeps the drawer and its handle on the minimum tint under data-glass=clear", () => {
    const rule =
      /\[data-glass="clear"\] :is\(([^)]*)\)\s*\{[^}]*--pn-min-tint/.exec(css);
    expect(rule?.[1]).toContain(".pn-tests-drawer");
    expect(rule?.[1]).toContain(".pn-tests-handle");
  });

  it("takes its fills and hairline from the glass tokens and keeps the 45% / 160px width", () => {
    const start = css.indexOf("\n.pn-tests-drawer {");
    const block = css.slice(start, css.indexOf("}", start));
    expect(block).toContain("var(--pn-glass-fill)");
    expect(block).toContain("var(--pn-hair)");
    expect(block).toContain("flex: 0 0 45%");
    expect(block).toContain("min-width: 160px");
  });
});
