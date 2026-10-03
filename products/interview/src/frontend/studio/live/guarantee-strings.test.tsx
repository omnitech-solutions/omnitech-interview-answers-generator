// Only true claims reach the screen. Every major state of the session UI is
// rendered through the real shell and its whole surface (text, titles, labels)
// is checked against claims the architecture does not support: undetectability,
// a connected companion without recorded contact, a persisted raw-audio option,
// sandbox limits the code runner does not set, "nothing is captured" said by
// the browser, and so on. A source scan backs it for states a render misses
// (the Workspace draft panel). ADR-0011 and ADR-0012 are the authority.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssistantConfig } from "@omnitech-assistant/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Studio } from "../studio";
import { LIVE, SCENARIOS } from "./live-scenarios";
import { installScriptedService } from "./live-script-kit";
import { minutesAfter, sessionView } from "./session-fixtures";
import { resetSessionStores } from "./session-registry";
import { REPORTS } from "./setup-capability-fixtures";

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
  // No stage reads screenshots (session-run.ts): they are stored for the owner
  // and no model interprets them.
  [/screen reading/i, "no model reads screenshots today"],
  [/reading the coding task/i, "no stage reads the screen"],
  [/coding tasks on your screen/i, "no stage reads the screen"],
  [/screenshots studio chooses/i, "Studio does not choose or interpret them"],
  // Device-only governs model calls only: the transcript still goes to
  // Studio's server, is stored in Postgres and processed by the worker.
  [
    /(content|session|transcript)[^.]{0,40}(is |are )?processed on this mac/i,
    "device-only is about AI models, not where content is stored or processed",
  ],
  [
    /processes content on this mac/i,
    "device-only is about AI models, not where content is processed",
  ],
  [
    /stays? on this mac|never leaves this mac/i,
    "the transcript is sent to Studio's server",
  ],
  [/tests could not run on this mac/i, "the runner is never on the Mac"],
  // The companion's speech is on-device under BOTH policies (ADR-0012 Locality
  // by stage; the companion requires on-device recognition), so allowing remote
  // processing never makes an unsupported language work.
  [
    /or allow remote processing/i,
    "speech stays on this Mac under both policies",
  ],
  [
    /allow(ing)? remote( processing)?[^.]{0,30}(fix|enable|make .{0,20}work)/i,
    "remote processing does not change on-device speech",
  ],
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

// Companion-side claims. The browser cannot observe the Mac, so each sentence
// that describes what the companion does is either backed by named tests (the
// file must exist and contain the test's exact title) and an ADR rule, or it
// must not be shown. A claim that is shown but not listed here fails.
const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
type Fact = { file: string; test: string };
// The handles the ADRs' governs blocks declare, read from the ADR files.
const ADR_HANDLES = ["ADR-0011", "ADR-0012"].flatMap((id) => {
  const dir = join(REPO, "bionic/adrs");
  const file = readdirSync(dir).find((name) => name.startsWith(`${id}-`));
  const text = file ? readFileSync(join(dir, file), "utf8") : "";
  return [...text.matchAll(/handle: (ADR-001[12]\/[a-z0-9-]+)/g)].map(
    (match) => match[1] as string,
  );
});
const COMPANION_CLAIMS: {
  claim: string;
  shown: RegExp;
  // The ADR rule the claim cites.
  rule: string;
  facts: Fact[];
}[] = [
  {
    claim:
      "you can stop it on the Mac at any time, even when Studio is unreachable",
    shown: /stop it on the Mac at any time, even when Studio is unreachable/,
    rule: "ADR-0011/stop-authority (the person's local Stop works without Studio)",
    facts: [
      {
        file: "apps/capture-companion/src/companion.test.ts",
        test: "stops synchronously with Studio permanently down and sends nothing more",
      },
      {
        file: "apps/capture-companion/macos/Tests/CaptureCoreTests/SessionTests.swift",
        test: "local stop is synchronous, needs no network, zeroes audio and persists a marker",
      },
    ],
  },
  {
    claim:
      "until you stop it, it keeps capturing and sends what it holds when Studio returns",
    shown: /keeps capturing and sends what it holds when Studio returns/,
    rule: "ADR-0011/idempotent-observation (held messages resend with the same ids)",
    facts: [
      {
        file: "apps/capture-companion/src/companion.test.ts",
        test: "resends the SAME ids after a dropped connection",
      },
    ],
  },
  {
    claim: "the companion can't add sources",
    shown: /(can’t|cannot) add sources/,
    rule: "ADR-0011/credential-ingest-scope; ADR-0012/tighten-only-locality (narrowing-only control)",
    facts: [
      {
        file: "products/interview/src/backend/live-session/ingest.test.ts",
        test: "refuses a source kind the session never agreed to, storing nothing",
      },
      {
        file: "apps/capture-companion/src/control.test.ts",
        test: "offers only locally selected sources and can only narrow",
      },
      {
        file: "apps/capture-companion/src/companion.test.ts",
        test: "resume restarts only locally selected sources, never ones Studio refused",
      },
    ],
  },
  {
    claim:
      "speech runs on this Mac, in the companion (only on an on-device report)",
    shown: /On this Mac, in the companion/,
    rule: "ADR-0012/declared-profile-locality (speech is on-device by declared locality)",
    facts: [
      {
        file: "apps/capture-companion/src/capability.test.ts",
        test: "is ready only with on-device recognition, a recognizer and authorization",
      },
      {
        file: "apps/capture-companion/src/companion.test.ts",
        test: "starts no source, reports why and heartbeats capturing:false",
      },
      {
        file: "apps/capture-companion/macos/Tests/CaptureCoreTests/SessionTests.swift",
        test: "a failed on-device capability check starts nothing and never falls back",
      },
      {
        file: "products/interview/src/frontend/studio/live/companion-capability.test.ts",
        test: "is ready, and on this Mac, only when on-device recognition is available and authorised",
      },
    ],
  },
];

describe("companion-side claims are backed or absent", () => {
  it.each(COMPANION_CLAIMS)(
    "$claim cites tests that exist",
    ({ facts, rule }) => {
      // Every cited handle must be a real governs handle of ADR-0011 or 0012.
      const cited = rule.match(/ADR-001[12]\/[a-z0-9-]+/g) ?? [];
      expect(cited.length, `${rule} cites an ADR handle`).toBeGreaterThan(0);
      for (const handle of cited)
        expect(ADR_HANDLES, `${handle} is not a governs handle`).toContain(
          handle,
        );
      for (const { file, test } of facts) {
        const path = join(REPO, file);
        expect(existsSync(path), `${file} exists`).toBe(true);
        expect(readFileSync(path, "utf8"), `${file} has "${test}"`).toContain(
          test,
        );
      }
    },
  );

  it("every companion claim Setup and the Sources tab show is in the table", async () => {
    // Setup, then a live session's Sources tab, with a ready report.
    for (const prepare of [
      (service: ReturnType<typeof installScriptedService>) => {
        service.script.capability = REPORTS.ready;
      },
      (service: ReturnType<typeof installScriptedService>) => {
        service.script.session = sessionView({
          lastHeartbeatAt: minutesAfter(1),
        });
        service.script.capability = REPORTS.ready;
      },
    ]) {
      const service = installScriptedService();
      prepare(service);
      await open(LIVE);
      const text = await readEverything();
      // Every phrase that makes a companion-side claim must be one the table
      // lists, worded exactly as listed.
      const phrases = text.match(
        /[^.\n]{0,60}(stop it on the Mac|keeps capturing|(can’t|cannot) add sources|in the companion)[^.\n]{0,70}/g,
      );
      expect(phrases?.length ?? 0).toBeGreaterThan(0);
      for (const phrase of phrases ?? [])
        expect(
          COMPANION_CLAIMS.some(({ shown }) => shown.test(phrase)),
          `unbacked companion claim: ${phrase}`,
        ).toBe(true);
      cleanup();
      resetSessionStores();
    }
  });

  it("never says on this Mac, in the companion without an on-device report", async () => {
    for (const report of [
      null,
      REPORTS.unsupported,
      REPORTS.denied,
      REPORTS.recognizerDown,
    ]) {
      const service = installScriptedService();
      service.script.session = sessionView({
        lastHeartbeatAt: minutesAfter(1),
      });
      service.script.capability = report;
      await open(LIVE);
      const text = await readEverything();
      expect(text).not.toMatch(/On this Mac, in the companion/);
      for (const [pattern, why] of FORBIDDEN)
        expect(text, `${pattern}: ${why}`).not.toMatch(pattern);
      cleanup();
      resetSessionStores();
    }
  });

  it.each(Object.entries(REPORTS))(
    "Setup keeps every forbidden claim out with the %s report",
    async (_name, report) => {
      const service = installScriptedService();
      service.script.capability = report;
      await open(LIVE);
      await advance(1_000);
      const text = await readEverything();
      for (const [pattern, why] of FORBIDDEN)
        expect(text, `${pattern}: ${why}`).not.toMatch(pattern);
      expect(text).not.toMatch(/companion connected|is connected/i);
    },
  );
});
