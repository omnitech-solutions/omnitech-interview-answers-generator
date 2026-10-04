// Every control in every major state of the session UI has an accessible name,
// and the ARIA wiring between controls and what they name resolves. No axe
// library is a dependency here, so this walks the DOM itself with the part of
// the accessible-name computation these views use: aria-labelledby, aria-label,
// native labels, content (skipping aria-hidden), then title. It does not judge
// contrast, focus order or screen-reader speech (unobserved without a browser).
import type { AssistantConfig } from "@omnitech-assistant/react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Studio } from "../studio";
import { LIVE, SCENARIOS } from "./live-scenarios";
import { installScriptedService } from "./live-script-kit";
import { minutesAfter } from "./session-fixtures";
import { resetSessionStores } from "./session-registry";

vi.mock("@omnitech-assistant/react", () => ({
  AssistantRoot: ({
    children,
  }: {
    config: AssistantConfig;
    children: React.ReactNode;
  }) => <div className="oa-root">{children}</div>,
  useAssistantHost: () => ({
    open: false,
    shortcut: "⌘J",
    toggle: () => undefined,
  }),
  Icon: () => <svg />,
}));
vi.mock("../workspace/workspace-view", () => ({
  WorkspaceView: () => <div>Workspace view</div>,
}));
vi.mock("../briefings/briefings-view", () => ({
  BriefingsView: () => <div>Briefings view</div>,
}));
vi.mock("../documents/documents-view", () => ({
  DocumentsView: () => <div>Documents view</div>,
}));
vi.mock("../home/home-view", () => ({ HomeView: () => <div>Home view</div> }));
vi.mock("../rehearsal/rehearsal-view", () => ({
  RehearsalView: () => <div>Rehearsal view</div>,
}));
vi.mock("../../library", () => ({ Library: () => <div>Library view</div> }));

const assistant = {
  client: {} as never,
  workspaceId: "interview",
  profileId: "local-interview",
};

// ---- The helper: names, by the order the browser uses ----------------------

const hidden = (element: Element): boolean =>
  element.getAttribute("aria-hidden") === "true" ||
  element.hasAttribute("hidden");

// Text content, leaving out what assistive technology skips.
function contentText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (!(node instanceof Element) || hidden(node)) return "";
  return [...node.childNodes].map(contentText).join(" ");
}

export function accessibleName(element: Element): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => element.ownerDocument.getElementById(id))
      .map((target) => (target ? contentText(target) : ""))
      .join(" ")
      .trim();
    if (text) return text;
  }
  const label = element.getAttribute("aria-label")?.trim();
  if (label) return label;
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const fromLabels = [...(element.labels ?? [])]
      .map((entry) => contentText(entry))
      .join(" ")
      .trim();
    if (fromLabels) return fromLabels.replace(/\s+/g, " ");
  } else {
    const content = contentText(element).replace(/\s+/g, " ").trim();
    if (content) return content;
  }
  return element.getAttribute("title")?.trim() ?? "";
}

const CONTROLS = [
  "button",
  "a[href]",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[role=button]",
  "[role=tab]",
  "[role=switch]",
  "[role=radio]",
  "[role=checkbox]",
  "[role=link]",
].join(",");

// Problems with controls and the wiring between them, as readable strings.
export function accessibilityProblems(root: ParentNode = document.body) {
  const problems: string[] = [];
  const describe = (element: Element) =>
    `<${element.tagName.toLowerCase()}${element.getAttribute("role") ? ` role=${element.getAttribute("role")}` : ""}${element.className ? ` class="${String(element.className)}"` : ""}>`;
  for (const control of root.querySelectorAll(CONTROLS)) {
    if (hidden(control) || control.closest("[aria-hidden=true]")) continue;
    if (!accessibleName(control))
      problems.push(`no name: ${describe(control)}`);
  }
  const ids = new Map<string, number>();
  for (const element of root.querySelectorAll("[id]"))
    ids.set(element.id, (ids.get(element.id) ?? 0) + 1);
  for (const [id, count] of ids)
    if (count > 1) problems.push(`duplicate id: ${id}`);
  // An unselected tab names a panel that is not rendered until it is
  // chosen (axe allows this too).
  for (const attribute of [
    "aria-labelledby",
    "aria-describedby",
    "aria-controls",
  ])
    for (const element of root.querySelectorAll(`[${attribute}]`))
      for (const id of (element.getAttribute(attribute) ?? "").split(/\s+/))
        if (
          id &&
          !document.getElementById(id) &&
          !(
            attribute === "aria-controls" &&
            (element.getAttribute("aria-selected") === "false" ||
              element.getAttribute("aria-expanded") === "false")
          )
        )
          problems.push(
            `${attribute} points nowhere: ${id} on ${describe(element)}`,
          );
  // Dialogs, tablists and the session landmarks carry a name of their own.
  for (const element of root.querySelectorAll(
    "[role=alertdialog],[role=dialog],[role=tablist],[role=group],section[aria-label],[role=list][aria-label]",
  ))
    if (!accessibleName(element))
      problems.push(`unnamed: ${describe(element)}`);
  for (const element of root.querySelectorAll(
    "[role=alertdialog],[role=dialog]",
  ))
    if (
      !element.getAttribute("aria-labelledby") &&
      !element.getAttribute("aria-label")
    )
      problems.push(`dialog without a name: ${describe(element)}`);
  for (const tab of root.querySelectorAll("[role=tab]"))
    if (
      !tab.getAttribute("aria-controls") &&
      !tab.getAttribute("aria-selected")
    )
      problems.push(`tab without state: ${describe(tab)}`);
  return problems;
}

// ---- The helper itself ------------------------------------------------------

describe("accessibilityProblems", () => {
  it("catches an unnamed button, a bare icon and a dangling reference", () => {
    const { container } = render(
      <div>
        <button type="button" />
        <button type="button">
          <span aria-hidden="true">sensors</span>
        </button>
        <input type="checkbox" aria-labelledby="missing" />
        <button type="button" id="same">
          Named
        </button>
        <button type="button" id="same" aria-label="Also named" />
      </div>,
    );
    const problems = accessibilityProblems(container);
    expect(problems.filter((p) => p.startsWith("no name"))).toHaveLength(3);
    expect(problems).toContain("duplicate id: same");
    expect(problems.some((p) => p.includes("points nowhere: missing"))).toBe(
      true,
    );
  });

  it("accepts labels, aria-label, content and a title", () => {
    const { container } = render(
      <div>
        <label>
          <input type="checkbox" /> Consent
        </label>
        <button type="button" aria-label="Copy">
          <span aria-hidden="true">content_copy</span>
        </button>
        <button type="button">Open</button>
        <button type="button" title="Tooltip only" />
      </div>,
    );
    expect(accessibilityProblems(container)).toEqual([]);
  });
});

// ---- The states --------------------------------------------------------------

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

async function open(path: string) {
  window.history.replaceState({}, "", path);
  render(<Studio assistant={assistant} />);
  await flush();
  await advance(1_000);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(minutesAfter(1)));
  resetSessionStores();
  sessionStorage.clear();
});
afterEach(() => {
  resetSessionStores();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("every control is named, in every major state", () => {
  it.each(SCENARIOS)("$name", async (scenario) => {
    const service = installScriptedService();
    scenario.prepare(service);
    await open(scenario.path ?? LIVE);
    expect(accessibilityProblems()).toEqual([]);
    for (const name of ["Transcript", "Activity", "Sources"]) {
      const tab = screen.queryByRole("tab", { name });
      if (!tab) continue;
      fireEvent.click(tab);
      expect(accessibilityProblems(), name).toEqual([]);
    }
  });

  it("setup: each target, strict rehearsal, remote, retention", async () => {
    installScriptedService();
    await open(LIVE);
    expect(accessibilityProblems()).toEqual([]);
    for (
      let attempt = 0;
      attempt < 20 && !screen.queryByLabelText(/Rehearsal/);
      attempt += 1
    )
      await flush();
    fireEvent.click(screen.getByLabelText(/Rehearsal/));
    fireEvent.click(screen.getByLabelText(/Strict rehearsal/));
    fireEvent.click(screen.getByRole("radio", { name: "Allow remote" }));
    fireEvent.click(screen.getByRole("radio", { name: "Until I delete" }));
    expect(accessibilityProblems()).toEqual([]);
    fireEvent.click(screen.getByLabelText(/Everyone in this interview/));
    expect(accessibilityProblems()).toEqual([]);
  });

  it("pairing credential shown, then the End popover and the deletion confirm", async () => {
    const service = installScriptedService();
    await open(LIVE);
    for (
      let attempt = 0;
      attempt < 20 && !screen.queryByLabelText(/Rehearsal/);
      attempt += 1
    )
      await flush();
    fireEvent.click(screen.getByLabelText(/Rehearsal/));
    fireEvent.click(screen.getByLabelText(/Everyone in this interview/));
    fireEvent.click(screen.getByRole("button", { name: "Start session" }));
    await flush();
    expect(screen.getByTestId("pairing-credential")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(accessibilityProblems()).toEqual([]);

    // The irreversible controls on the Sources tab.
    service.patch({
      processingPolicy: "permitted-remote",
      retention: "until-deleted",
    });
    await advance(1_000);
    fireEvent.click(screen.getByRole("tab", { name: "Sources" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Switch to this Mac only" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Shorten to 30 days/ }));
    expect(accessibilityProblems()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "End" }));
    const dialog = screen.getByRole("alertdialog");
    expect(accessibleName(dialog)).toBe("End this session?");
    expect(accessibilityProblems()).toEqual([]);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "End session" }),
    );
    await flush();

    // Ended: the summary, then the deletion confirm.
    fireEvent.click(
      screen.getByRole("button", { name: "Delete session data" }),
    );
    expect(accessibilityProblems()).toEqual([]);
  });
});
