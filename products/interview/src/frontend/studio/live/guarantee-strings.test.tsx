// Only true claims reach the screen. Every major state of the session UI is
// rendered through the real shell and its whole surface (text, titles, labels)
// is checked against claims the architecture does not support: undetectability,
// a connected companion without recorded contact, a persisted raw-audio option,
// sandbox limits the code runner does not set, "nothing is captured" said by
// the browser, and so on. A source scan backs it for states a render misses
// (the Workspace draft panel). ADR-0011 and ADR-0012 are the authority.
import type { AssistantConfig } from "@omnitech-assistant/react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Studio } from "../studio";
import { installScriptedService } from "./live-script-kit";
import { LIVE, SCENARIOS } from "./live-scenarios";
import { minutesAfter, sessionView } from "./session-fixtures";
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

// Claims that are never true here. Each names why.
export const FORBIDDEN: readonly [RegExp, string][] = [
  [/renews? every/i, "credential renewal is by the owner, up to 2 hours"],
  [
    /\b10\s*min(ute)?s?\b.{0,30}renew|renew.{0,30}\b10\s*min/i,
    "no 10 minute renewal",
  ],
  [/undetect/i, "no undetectability claim (book Constraint)"],
  [/invisible/i, "no concealment claim"],
  [/hidden from/i, "no concealment claim"],
  [/can(no|')?t be (seen|detected|noticed)/i, "no concealment claim"],
  [/\b512\s*MB\b/i, "the runner sets 256 MB for tests"],
  [/\b10\s*s\s*limit\b/i, "the runner's test budget is 20 s"],
  [/host folders?/i, "only the run's own temporary files are mounted"],
  [/capture companion connected/i, "never unconditional"],
  [
    /nothing is being captured/i,
    "the browser cannot know what the Mac captures",
  ],
  [
    /keep the raw audio|save the raw audio|audio recording/i,
    "raw audio is never persisted",
  ],
  [
    /raw audio.{0,40}(toggle|retained|kept for|saved for)/i,
    "raw audio is never persisted",
  ],
  [/hint count.{0,20}(client|browser)/i, "the server derives hints"],
];

// Every attribute a screen reader or tooltip would speak, as well as the text.
function surface(): string {
  const parts = [document.body.textContent ?? ""];
  for (const element of document.body.querySelectorAll(
    "[title],[aria-label],[placeholder],[alt],[aria-description]",
  ))
    for (const name of [
      "title",
      "aria-label",
      "placeholder",
      "alt",
      "aria-description",
    ]) {
      const value = element.getAttribute(name);
      if (value) parts.push(value);
    }
  return parts.join("\n");
}

const flush = () => act(() => vi.advanceTimersByTimeAsync(0));
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

async function open(path: string) {
  window.history.replaceState({}, "", path);
  render(<Studio assistant={assistant} />);
  await flush();
  await advance(1_000);
}

// Reads the page, then each tab the live panel has, so every tab's copy is seen.
async function readEverything(): Promise<string> {
  let text = surface();
  for (const name of ["Transcript", "Activity", "Sources"]) {
    const tab = screen.queryByRole("tab", { name });
    if (!tab) continue;
    fireEvent.click(tab);
    text += `\n${surface()}`;
  }
  return text;
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

describe("only true claims are shown", () => {
  it.each(SCENARIOS)("$name", async (scenario) => {
    const service = installScriptedService();
    scenario.prepare(service);
    await open(scenario.path ?? LIVE);
    const text = await readEverything();
    for (const [pattern, why] of FORBIDDEN)
      expect(text, `${pattern}: ${why}`).not.toMatch(pattern);
    for (const pattern of scenario.must ?? [])
      expect(text, `expected ${pattern}`).toMatch(pattern);
    for (const pattern of scenario.mustNot ?? [])
      expect(text, `unexpected ${pattern}`).not.toMatch(pattern);
  });

  it("shows the bar on another page with the same restraint", async () => {
    const service = installScriptedService();
    service.script.session = sessionView({ status: "created" });
    await open("/t/local/p/interview/knowledge");
    const bar = screen.getByTestId("session-bar");
    expect(bar).toHaveTextContent("Waiting for companion");
    expect(bar).not.toHaveTextContent(/receiving|connected/i);
    for (const [pattern] of FORBIDDEN) expect(surface()).not.toMatch(pattern);
  });

  it("offers no raw-audio persistence control anywhere in Setup", async () => {
    installScriptedService();
    await open(LIVE);
    const controls = [
      ...screen.getAllByRole("switch"),
      ...document.querySelectorAll("input[type=checkbox]"),
    ].map(
      (element) =>
        element.getAttribute("aria-label") ??
        element.parentElement?.textContent ??
        "",
    );
    expect(controls.join("\n")).not.toMatch(/audio recording|raw audio/i);
  });
});

// A source scan for the states a render cannot reach cheaply (the Workspace
// draft panel and the ended summary's branches). Comments may name a claim to
// forbid it; only code and string literals count.
describe("source scan", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const files = [
    ...readdirSync(here)
      .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\./.test(file))
      .filter(
        (file) => !/fixtures|test-server|script-kit|live-scenarios/.test(file),
      )
      .map((file) => join(here, file)),
    join(here, "..", "rehearsal", "scorecard.tsx"),
  ];
  const code = (file: string) =>
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "$1");

  it("has no forbidden claim in any live view source", () => {
    expect(files.length).toBeGreaterThan(30);
    for (const file of files)
      for (const [pattern, why] of FORBIDDEN)
        expect(code(file), `${file}: ${pattern} (${why})`).not.toMatch(pattern);
  });
});
