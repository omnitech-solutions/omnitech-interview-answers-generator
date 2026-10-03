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
import {
  action,
  disconnected,
  gap,
  minutesAfter,
  SESSION_ID,
  sessionView,
  transcript,
} from "./session-fixtures";
import { resetSessionStores } from "./session-registry";
import {
  answerResult,
  codeResult,
  codingAnswer,
  logisticsResult,
  starResult,
} from "./session-result-fixtures";

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

type Scenario = {
  name: string;
  path?: string;
  prepare(service: ReturnType<typeof installScriptedService>): void;
  // Claims that must hold in this state.
  must?: RegExp[];
  // Wording that would be false in this state.
  mustNot?: RegExp[];
};

const LIVE = "/t/local/p/interview/live";
const fresh = () => ({ lastHeartbeatAt: minutesAfter(1) });

const SCENARIOS: Scenario[] = [
  {
    name: "setup, defaults",
    prepare: () => undefined,
    must: [/Device only/, /Raw audio/, /Memory only, never saved/],
    mustNot: [/connected/i, /receiving/i],
  },
  {
    name: "just started: no contact recorded",
    prepare: ({ script }) => {
      script.session = sessionView({ status: "created" });
    },
    must: [/Waiting for first contact/],
    mustNot: [
      /connected/i,
      /receiving/i,
      /In contact/,
      /Listening for a question/,
    ],
  },
  {
    name: "live and listening",
    prepare: ({ script }) => {
      script.session = sessionView(fresh());
    },
    must: [/Listening for a question/, /In contact/],
    mustNot: [/Waiting for the capture companion/],
  },
  {
    name: "paused",
    prepare: ({ script }) => {
      script.session = sessionView({ status: "paused", ...fresh() });
    },
    must: [/Paused/, /any result that arrives while paused is discarded/],
    mustNot: [/Listening for a question/],
  },
  {
    name: "permission revoked and a dropped gap",
    prepare: ({ script }) => {
      script.session = sessionView(fresh());
      script.observations = [
        disconnected(1, "microphone", "permission-revoked"),
        gap(2, "application-audio", "buffer-overflow", 4000),
      ];
    },
    must: [/Permission revoked/, /recorded in the transcript/],
    mustNot: [/Receiving/],
  },
  {
    name: "companion out of contact",
    prepare: ({ script }) => {
      script.session = sessionView({ lastHeartbeatAt: minutesAfter(-3) });
      script.observations = [transcript(1, "Words from earlier.")];
    },
    must: [/No contact for/, /can't tell whether anything is being captured/],
    mustNot: [
      /Receiving/,
      /In contact/,
      /connected/i,
      /Listening for a question/,
    ],
  },
  {
    name: "credential expired",
    prepare: ({ script }) => {
      script.session = sessionView({
        credentialExpiresAt: minutesAfter(0, 30),
        ...fresh(),
      });
    },
    must: [/credential has expired/],
  },
  {
    name: "credential revoked",
    prepare: ({ script }) => {
      script.session = sessionView({ credentialRevoked: true, ...fresh() });
    },
    must: [/credential was revoked/],
  },
  {
    name: "answers of every kind, withheld and refused work, remote policy",
    prepare: ({ script }) => {
      script.session = sessionView({
        processingPolicy: "permitted-remote",
        ...fresh(),
      });
      script.observations = [transcript(1, "Question one.")];
      script.actions = [
        action({ taskId: "a", result: answerResult() }),
        action({ taskId: "b", result: starResult() }),
        action({ taskId: "c", result: logisticsResult() }),
        action({ taskId: "d", result: codingAnswer(["Single thread"]) }),
        action({
          taskId: "d",
          actionKind: "solve-code",
          result: codeResult(),
        }),
        action({
          taskId: "e",
          dispatchStatus: "suppressed",
          suppressionReason: "invalid_output",
          result: { withheld: { rejectedClaimCount: 1 } },
        }),
      ];
    },
    must: [/Remote allowed/, /Profile fast · device-only policy/],
    // Remote is allowed here, so nothing may say content stays on this Mac.
    mustNot: [
      /On this Mac only/,
      /never sent elsewhere/,
      /Refused: needs a remote model/,
    ],
  },
  {
    name: "device-only refusing coding work",
    prepare: ({ script }) => {
      script.session = sessionView(fresh());
      script.actions = [
        action({
          taskId: "x",
          actionKind: "solve-code",
          dispatchStatus: "suppressed",
          suppressionReason: "policy_refused",
        }),
      ];
    },
    must: [/On this Mac only/, /Refused: needs a remote model/],
    mustNot: [/Remote allowed/, /Remote model, through Studio/],
  },
  {
    name: "ended summary",
    path: `${LIVE}/${SESSION_ID}`,
    prepare: ({ script }) => {
      script.session = sessionView({
        status: "ended",
        endedAt: minutesAfter(5),
      });
      script.actions = [action({ taskId: "a", result: answerResult() })];
    },
    must: [
      /Nothing was submitted or sent for you/,
      /Raw audio is never stored/,
      /not deleted with it/,
    ],
    mustNot: [/nothing is running/i],
  },
  {
    name: "deleted session tombstone",
    path: `${LIVE}/${SESSION_ID}`,
    prepare: ({ script }) => {
      script.session = sessionView({
        status: "ended",
        endedAt: minutesAfter(5),
        purged: true,
      });
    },
    must: [/Session data deleted/, /were not deleted|not part of the session/],
  },
];

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
      .filter((file) => !/fixtures|test-server|script-kit/.test(file))
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
