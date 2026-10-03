import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { rehearsalScore } from "@omnitech/interview-contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioActions } from "../config/commands";
import { StudioContext, type StudioContextValue } from "../context";
import type { StudioLists } from "../use-studio-lists";
import { clock, phaseAt, scoreHeadline, formatById } from "./config";
import { codingMaterial } from "./material";
import type { RehearsalCommand } from "../playground-control";
import { RehearsalView } from "./rehearsal-view";
import { guidedProse } from "../../../answer-fixture";
import { jsonResponse, sessionView } from "../live/session-fixtures";
import { getSessionStore, resetSessionStores } from "../live/session-registry";
import { forgetSavedRehearsalRuns } from "../live/rehearsal-run-link";

const draft = {
  question: "Find the pair that sums to the target.",
  notes: "",
  answer: {
    title: "Two sum",
    language: "typescript",
    ...guidedProse("x"),
    code: "function twoSum() {}",
    usageCode: "",
    testCode: "it('finds the pair')",
    guide: {
      version: 1,
      understand: {
        prompt: "Return the indices of the two numbers that add to target.",
        examples: [{ input: "[2,7,11,15], 9", output: "[0,1]" }],
        constraints: [],
        clarify: ["Can a number be reused?", "Is there always an answer?"],
      },
      plan: {
        steps: ["Remember each number's index.", "Look up the complement."],
        complexity: { time: "O(n)", space: "O(n)" },
      },
      edgeCases: [{ name: "No pair" }],
      explain: [{ heading: "Hash map lookup", body: "…" }],
      talkingPoints: ["a", "b", "c"],
    },
  },
};
const brief = {
  id: "b1",
  kind: "concept",
  topic: "How does React re-render?",
  title: "How does React re-render?",
  updatedAt: "2026-10-01T00:00:00.000Z",
  brief: {
    version: 1,
    headline: "h",
    points: [
      { heading: "a", body: "b" },
      { heading: "c", body: "d" },
      { heading: "e", body: "f" },
    ],
    example: "x",
    pitfall: "y",
    followUps: [{ question: "What does memo compare?", answer: "Props." }],
  },
};

let saves: unknown[];
let saveFails: boolean;
// The server already derived hints for this run id (a save before a reload).
let runAlreadySaved = false;
// What the server adds to a saved rehearsal (the derived session hints).
let saveExtra: Record<string, unknown> = {};
// The Active Session the store holds (null: none open).
let liveSession: ReturnType<typeof sessionView> | null = null;
let loadFails: boolean;
function installServer() {
  saves = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input === "/api/interview/rehearsals" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        saves.push(body);
        if (runAlreadySaved && body.rehearsalRunId)
          return Response.json(
            { error: { code: "rehearsal-run-already-saved" } },
            { status: 409 },
          );
        return saveFails
          ? Response.json({ error: { code: "boom" } }, { status: 500 })
          : Response.json({
              ...body,
              id: "r1",
              score: rehearsalScore(body.checks.length, body.reveals.length),
              ...saveExtra,
            });
      }
      if (input.startsWith("/api/interview/t/local/sessions"))
        return liveSession && input.endsWith("/current")
          ? jsonResponse({ session: liveSession })
          : input.endsWith("/stream") && liveSession
            ? jsonResponse({
                session: liveSession,
                observations: [],
                actions: [],
                nextAfterSequence: 0,
                nextActionCursor: "c",
                hasMoreObservations: false,
                hasMoreActions: false,
                serverNow: new Date().toISOString(),
              })
            : jsonResponse({ error: { code: "not_found" } }, 404);
      if (loadFails) return Response.json({}, { status: 500 });
      if (input === "/api/interview/workspaces/interview/artifacts/q1")
        return Response.json({ origin: {}, value: draft });
      if (input === "/api/interview/briefs/b1") return Response.json(brief);
      return Response.json({ error: { code: "not-found" } }, { status: 404 });
    }),
  );
}

const actions: StudioActions = {
  go: vi.fn(),
  openArtifact: vi.fn(),
  openBriefing: vi.fn(),
  openBrief: vi.fn(),
  newQuestion: vi.fn(),
  runTests: vi.fn(),
  toggleTheme: vi.fn(),
  toggleAssistant: vi.fn(),
};
const lists = (questions = true): StudioLists => ({
  status: "ready",
  refresh: vi.fn(),
  questions: questions
    ? [
        {
          artifactId: "q1",
          title: "Two sum",
          kind: "coding",
          language: "typescript",
          updatedAt: "2026-10-01T00:00:00.000Z",
        },
      ]
    : [],
  briefings: [],
  briefs: [
    {
      id: "b1",
      kind: "concept",
      topic: "How does React re-render?",
      title: "How does React re-render?",
      updatedAt: "2026-10-01T00:00:00.000Z",
    },
  ],
});
const setFocus = vi.fn();
function view(withQuestions = true) {
  const context = { setFocus } as unknown as StudioContextValue;
  return render(
    <StudioContext.Provider value={context}>
      <RehearsalView
        actions={actions}
        lists={lists(withQuestions)}
        workspaceId="interview"
      />
    </StudioContext.Provider>,
  );
}
// Lets pending fetches settle while fake timers are installed.
// Focus mode is set by a passive effect, which React flushes after the commit
// that put the phase on screen: findBy* can resolve on the DOM change first.
// act() drains pending effects, so the assertion no longer races them.
const flushEffects = () => act(async () => {});
const settle = () =>
  act(async () => {
    for (let index = 0; index < 5; index++) await Promise.resolve();
  });

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  saveFails = false;
  runAlreadySaved = false;
  loadFails = false;
  saveExtra = {};
  liveSession = null;
  resetSessionStores();
  forgetSavedRehearsalRuns();
  installServer();
});
afterEach(() => {
  vi.useRealTimers();
  resetSessionStores();
});

describe("Rehearsal setup", () => {
  it("offers the formats and the questions each one asks", () => {
    view();
    expect(screen.getByRole("radio", { name: /Full loop/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      screen.getByText("How does React re-render?, then Two sum"),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: /Coding · 45/ }));
    expect(screen.getByText("Two sum")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Start coding · 45 min/ }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("radio", { name: /Concept sprint/ }));
    expect(screen.getByText("How does React re-render?")).toBeVisible();

    // Built-in prompts join the person's briefs.
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.change(screen.getByLabelText("Concept"), {
      target: { value: "prompt:http-caching" },
    });
    expect(
      screen.getByText(
        "How does HTTP caching work between a browser and an API?",
        { selector: "div" },
      ),
    ).toBeVisible();
    expect(screen.queryByLabelText("Coding")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    const strict = screen.getByRole("switch", { name: "Strict mode" });
    expect(strict).toHaveAttribute("aria-checked", "false");
    fireEvent.click(strict);
    expect(strict).toHaveAttribute("aria-checked", "true");
  });

  it("needs a coding question before a coding format can start", () => {
    view(false);
    expect(
      screen.getByText(
        "No coding questions yet. Add one in the Workspace first.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /Start full loop/ }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /Concept sprint/ }));
    expect(
      screen.getByRole("button", { name: /Start concept sprint/ }),
    ).toBeEnabled();
  });

  it("says when the questions cannot be loaded", async () => {
    loadFails = true;
    view();
    fireEvent.click(screen.getByRole("button", { name: /Start full loop/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The questions couldn’t be loaded.",
    );
  });
});

describe("Rehearsal session", () => {
  it("runs a full loop and scores what was ticked and opened", async () => {
    view();
    fireEvent.click(screen.getByRole("button", { name: /Start full loop/ }));
    expect(await screen.findByText("CONCEPT PHASE")).toBeVisible();
    await flushEffects();
    expect(setFocus).toHaveBeenLastCalledWith("live");
    expect(screen.getByText("QUESTION 1 OF 2 · CONCEPT")).toBeVisible();
    expect(screen.getByLabelText("Phase time left")).toHaveTextContent("15:00");

    // The interviewer's follow-ups come from the brief, one at a time.
    fireEvent.click(screen.getByRole("button", { name: "Ask a follow-up" }));
    expect(screen.getByText("“What does memo compare?”")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Ask a follow-up" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: /Restated/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Talked while/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Talked while/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Covered edge/ }));
    expect(screen.getByText("2 / 10")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Start coding" }));
    expect(screen.getByText("CODING PHASE")).toBeVisible();
    expect(
      screen.getByText(
        "Return the indices of the two numbers that add to target.",
      ),
    ).toBeVisible();
    expect(screen.getByText("[2,7,11,15], 9 → [0,1]")).toBeVisible();

    // Hints come from the guide; the solution waits for the complexity.
    const hints = within(
      screen.getByText("−3 each").closest(".rehearsal-card") as HTMLElement,
    );
    expect(
      hints.getByRole("button", { name: /Reference solution/ }),
    ).toBeDisabled();
    fireEvent.click(hints.getByRole("button", { name: /^Hint/ }));
    expect(hints.getByText("Remember each number's index.")).toBeVisible();
    expect(hints.getByText("opened")).toBeVisible();
    fireEvent.change(screen.getByPlaceholderText(/O\(n\) time/), {
      target: { value: "O(n) time" },
    });
    expect(
      hints.getByRole("button", { name: /Reference solution/ }),
    ).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Your solution"), {
      target: { value: "const seen = new Map();" },
    });

    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    expect(await screen.findByText("Worth another run")).toBeVisible();
    expect(screen.getByText("17")).toBeVisible();
    expect(
      screen.getByText("20 from the checklist, −3 for 1 hint."),
    ).toBeVisible();
    expect(
      await screen.findByText("Saved to your rehearsal history."),
    ).toBeVisible();
    expect(saves[0]).toMatchObject({
      format: "full",
      strict: false,
      followUps: true,
      concept: { source: "brief", ref: "b1" },
      coding: { source: "question", ref: "q1", title: "Two sum" },
      checks: [0, 8],
      reveals: ["hint1"],
    });
    await flushEffects();
    expect(setFocus).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByRole("button", { name: /Asked clarifying/ }));
    expect(actions.openArtifact).toHaveBeenCalledWith("q1");
    fireEvent.click(
      screen.getByRole("button", { name: /How does React re-render/ }),
    );
    expect(actions.openBrief).toHaveBeenCalledWith("b1");
    fireEvent.click(screen.getByRole("button", { name: "Back to prep plan" }));
    expect(actions.go).toHaveBeenCalledWith("home");
    fireEvent.click(screen.getByRole("button", { name: "Rehearse again" }));
    expect(screen.getByRole("radio", { name: /Full loop/ })).toBeVisible();
  });

  it("warns near the end of a strict coding session, then ends it", async () => {
    vi.useFakeTimers();
    view();
    fireEvent.click(screen.getByRole("radio", { name: /Coding · 45/ }));
    fireEvent.click(screen.getByRole("switch", { name: "Strict mode" }));
    fireEvent.click(screen.getByRole("button", { name: /Start coding · 45/ }));
    await settle();
    expect(screen.getByText("CODING PHASE")).toBeVisible();
    expect(setFocus).toHaveBeenLastCalledWith("strict");
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();

    act(() => vi.advanceTimersByTime((45 * 60 - 300) * 1000));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Five minutes left in the coding phase.",
    );
    act(() => vi.advanceTimersByTime(240 * 1000));
    expect(screen.getByRole("status")).toHaveTextContent(
      "One minute left in this phase.",
    );
    act(() => vi.advanceTimersByTime(60 * 1000));
    await settle();
    expect(screen.getByText("Worth another run")).toBeVisible();
    expect(screen.getByText("45:00")).toBeVisible();
    expect(saves[0]).toMatchObject({ strict: true, concept: null });
  });

  it("pauses the clock, and says when a session could not be saved", async () => {
    vi.useFakeTimers();
    saveFails = true;
    view();
    fireEvent.click(screen.getByRole("radio", { name: /Concept sprint/ }));
    fireEvent.click(
      screen.getByRole("switch", { name: "Interviewer follow-ups" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Start concept/ }));
    await settle();
    expect(screen.queryByRole("button", { name: "Start coding" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Ask a follow-up" }),
    ).toBeNull();
    act(() => vi.advanceTimersByTime(3000));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(screen.getByText("Paused. The clock is stopped.")).toBeVisible();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByLabelText("Phase time left")).toHaveTextContent("14:57");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    fireEvent.change(screen.getByLabelText("Points I missed"), {
      target: { value: "Context" },
    });
    fireEvent.click(screen.getByRole("button", { name: "End session" }));
    await settle();
    expect(screen.getByText("This session couldn’t be saved.")).toBeVisible();
    vi.useRealTimers();
    await waitFor(() => expect(saves).toHaveLength(1));
  });
});

// A rehearsal session minted in Setup carries a run id; the Rehearsal save
// sends it so the server can count the shown drafts as hints (ADR-0012
// rule:assistance-counts-as-hints). There is still one scorecard.
describe("Rehearsal with a live session", () => {
  async function holdSession(overrides: Parameters<typeof sessionView>[0]) {
    liveSession = sessionView({ status: "ended", ...overrides });
    // The Studio shell keeps the store subscribed; do the same here.
    getSessionStore("local").subscribe(() => undefined);
    await act(async () => {
      for (let index = 0; index < 20; index++) await Promise.resolve();
    });
  }
  async function finishConceptSprint() {
    view();
    fireEvent.click(screen.getByRole("radio", { name: /Concept sprint/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start concept/ }));
    fireEvent.click(await screen.findByRole("button", { name: "End session" }));
  }

  it("sends the run id of the session and shows the hints the server counted", async () => {
    await holdSession({ rehearsalRunId: "run-1", shownDraftCount: 2 });
    saveExtra = { score: 94, sessionHints: 2 };
    await finishConceptSprint();
    expect(
      await screen.findByText("Saved to your rehearsal history."),
    ).toBeVisible();
    expect(saves).toHaveLength(1);
    expect(saves[0]).toMatchObject({ rehearsalRunId: "run-1", strict: false });
    expect(screen.getByText("94")).toBeVisible();
    expect(
      screen.getByText(/2 hints from your live session are included/),
    ).toBeVisible();
  });

  it("never sends the same run id twice", async () => {
    await holdSession({ rehearsalRunId: "run-1" });
    await finishConceptSprint();
    await screen.findByText("Saved to your rehearsal history.");
    fireEvent.click(screen.getByRole("button", { name: "Rehearse again" }));
    fireEvent.click(screen.getByRole("radio", { name: /Concept sprint/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start concept/ }));
    fireEvent.click(await screen.findByRole("button", { name: "End session" }));
    await waitFor(() => expect(saves).toHaveLength(2));
    expect(saves[0]).toHaveProperty("rehearsalRunId", "run-1");
    expect(saves[1]).not.toHaveProperty("rehearsalRunId");
  });

  it("leaves the run id out when the session's strictness differs, and says so", async () => {
    await holdSession({ rehearsalRunId: "run-1", strict: true });
    await finishConceptSprint();
    await screen.findByText("Saved to your rehearsal history.");
    expect(saves[0]).not.toHaveProperty("rehearsalRunId");
    expect(
      screen.getByText(
        /different strictness, so this session's hints were NOT applied to the score/,
      ),
    ).toBeVisible();
  });

  it("retries once without the run id when the server already derived it, and says so", async () => {
    // E.g. a save before a reload that this page no longer remembers.
    runAlreadySaved = true;
    await holdSession({ rehearsalRunId: "run-1" });
    await finishConceptSprint();
    expect(
      await screen.findByText("Saved to your rehearsal history."),
    ).toBeVisible();
    expect(saves).toHaveLength(2);
    expect(saves[0]).toHaveProperty("rehearsalRunId", "run-1");
    expect(saves[1]).not.toHaveProperty("rehearsalRunId");
    expect(
      screen.getByText(/already counted by an earlier save/),
    ).toBeVisible();
  });

  it("sends no run id without a rehearsal session", async () => {
    await holdSession({ rehearsalRunId: null });
    await finishConceptSprint();
    await screen.findByText("Saved to your rehearsal history.");
    expect(saves[0]).not.toHaveProperty("rehearsalRunId");
    expect(screen.queryByText(/live session/)).toBeNull();
  });
});

describe("Rehearsal from the CLI", () => {
  it("starts, ends and resets on mock-interview commands, once each", async () => {
    const context = { setFocus } as unknown as StudioContextValue;
    const at = (command: RehearsalCommand) => (
      <StudioContext.Provider value={context}>
        <RehearsalView
          actions={actions}
          lists={lists()}
          workspaceId="interview"
          command={command}
        />
      </StudioContext.Provider>
    );
    const { rerender } = render(
      at({ id: "cli-1", action: "start", strict: true }),
    );
    expect(await screen.findByText("CONCEPT PHASE")).toBeVisible();
    await flushEffects();
    expect(setFocus).toHaveBeenLastCalledWith("strict");
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();

    rerender(at({ id: "cli-2", action: "end", strict: false }));
    expect(await screen.findByText("Worth another run")).toBeVisible();
    // A command already acted on is not run again.
    rerender(at({ id: "cli-1", action: "start", strict: true }));
    expect(screen.getByText("Worth another run")).toBeVisible();

    rerender(at({ id: "cli-3", action: "reset", strict: false }));
    expect(screen.getByRole("radio", { name: /Full loop/ })).toBeVisible();
    // End outside a live session changes nothing.
    rerender(at({ id: "cli-4", action: "end", strict: false }));
    expect(screen.getByRole("radio", { name: /Full loop/ })).toBeVisible();
  });
});

describe("rehearsal material and config", () => {
  it("offers only the hints an answer can supply", () => {
    const choice = { source: "question" as const, ref: "q", title: "Q" };
    const bare = codingMaterial(choice, {
      question: "Reverse a list.",
      notes: "",
      answer: null,
    });
    expect(bare).toEqual({
      choice,
      statement: "Reverse a list.",
      example: null,
      reveals: {},
    });
    const full = codingMaterial(choice, draft as never);
    expect(Object.keys(full.reveals)).toEqual([
      "clarify",
      "hint1",
      "pattern",
      "approach",
      "edge",
      "solution",
      "tests",
    ]);
    expect(full.reveals.approach).toBe(
      "1. Remember each number's index.\n2. Look up the complement.",
    );
  });

  it("works out the phase, the clock and the headline", () => {
    const full = formatById("full");
    expect(phaseAt(full, 0)).toMatchObject({
      phase: "concept",
      phaseLeft: 900,
      sessionLeft: 3600,
      warning: null,
    });
    expect(phaseAt(full, 700).warning).toBe("soon");
    expect(phaseAt(full, 850).warning).toBe("last");
    expect(phaseAt(full, 900)).toMatchObject({
      phase: "coding",
      phaseLeft: 2700,
    });
    expect(clock(65)).toBe("1:05");
    expect(clock(-3)).toBe("0:00");
    expect(scoreHeadline(80)).toBe("Strong session");
    expect(scoreHeadline(50)).toBe("Solid, with gaps");
    expect(scoreHeadline(10)).toBe("Worth another run");
  });
});
