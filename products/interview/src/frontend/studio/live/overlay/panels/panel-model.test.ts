import { describe, expect, it } from "vitest";
import type { TaskView } from "../../session-tasks";
import { taskStage } from "./panel-model";

describe("a task's stage", () => {
  const run = (actionKind: string, state: string) => ({
    actionKind,
    state,
    createdAt: "2026-10-04T10:00:00Z",
  });
  const task = (
    runs: ReturnType<typeof run>[],
    kind = "programming-challenge",
  ) => ({ kind, current: { runs } }) as unknown as TaskView;

  it("reads the problem while the answer is drafted for a coding task", () => {
    expect(taskStage(task([run("draft-answer", "running")]))?.label).toBe(
      "Reading the problem",
    );
  });

  it("drafts an answer for any other kind of question", () => {
    expect(
      taskStage(task([run("draft-answer", "running")], "experience-question"))
        ?.label,
    ).toBe("Drafting an answer");
  });

  it("solutions once the code is being written, even if the draft still runs", () => {
    expect(
      taskStage(
        task([run("draft-answer", "running"), run("solve-code", "running")]),
      )?.label,
    ).toBe("Solutioning");
  });

  it("has no stage when nothing is running", () => {
    expect(taskStage(task([run("draft-answer", "published")]))).toBeNull();
    expect(taskStage(task([]))).toBeNull();
  });
});

// ---- What the conversation and the panes say, from the session's own data ------

import { deriveLiveModel } from "../../session-state";
import { taskCardModel } from "../../shared/task-card-model";
import { answerAction } from "../../testing/live-view-kit";
import {
  action,
  minutesAfter,
  sessionView,
  snapshot,
  transcript,
} from "../../testing/session-fixtures";
import {
  answerResult,
  codingAnswer,
} from "../../testing/session-result-fixtures";
import {
  codePlaceholder,
  followUpPlaceholder,
  groupHeard,
  panelRows,
  speakerOf,
  stoppedByYou,
  taskChips,
  taskMarkers,
} from "./panel-model";

const modelOf = (
  actions: ReturnType<typeof action>[],
  observations = [snapshot(1)],
) =>
  deriveLiveModel({
    session: sessionView({ processingPolicy: "permitted-remote" }),
    observations,
    actions,
    serverClockOffsetMs: 0,
    nowMs: Date.parse(minutesAfter(2)),
  });
const stopped = (taskId: string, actionKind = "draft-answer") =>
  action({
    taskId,
    actionKind,
    dispatchStatus: "suppressed",
    suppressionReason: "owner_stopped",
    createdAt: minutesAfter(1, 8),
    updatedAt: minutesAfter(1, 9),
  });
const first = answerAction(codingAnswer([], "Rate limiter."), {
  sourceSnapshots: [{ sourceId: "screen", eventId: "evt-1" }],
});

describe("who said it", () => {
  it("names the speaker from the capture source alone", () => {
    expect(speakerOf("application-audio")).toEqual({
      speaker: "interviewer",
      label: "Interviewer · app audio",
    });
    expect(speakerOf("microphone")).toEqual({
      speaker: "you",
      label: "You · mic",
    });
    expect(speakerOf("screen")).toEqual({ speaker: "heard", label: "Heard" });
    expect(speakerOf(null)).toEqual({ speaker: "heard", label: "Heard" });
  });

  it("labels heard rows by the source id the companion and the owner really use", () => {
    const model = modelOf(
      [],
      [
        snapshot(1),
        transcript(2, "a.", { sourceId: "application-audio-run1" }),
        transcript(3, "b.", { sourceId: "microphone-run1" }),
        transcript(4, "c.", { sourceId: "studio.owner-microphone" }),
        transcript(5, "d.", { sourceId: "unknown-source" }),
      ],
    );
    expect(panelRows(model, []).map((row) => [row.text, row.label])).toEqual([
      ["a.", "Interviewer · app audio"],
      // Both microphone ids are "You · mic", and phrases that close together are one bubble.
      ["b. c.", "You · mic"],
      ["d.", "Heard"],
    ]);
  });

  it("labels what was typed, and the reply with its task", () => {
    const model = modelOf([first]);
    const rows = panelRows(model, [
      {
        key: "t",
        kind: "Typed",
        text: "why?",
        at: Date.parse(minutesAfter(2)),
      },
    ]);
    expect(rows.find((row) => row.kind === "typed")?.label).toBe("You · typed");
    expect(rows.find((row) => row.kind === "assistant")?.label).toBe(
      "Studio · T1",
    );
  });
});

describe("markers between the lines", () => {
  const input = (actions: ReturnType<typeof action>[]) => {
    const model = modelOf(actions);
    return {
      tasks: model.tasks,
      actions,
      observations: [snapshot(1)],
      deviceOnly: false,
    };
  };

  it("says which screenshot a task started from when the stream names it", () => {
    expect(taskMarkers(input([first])).map((marker) => marker.text)).toEqual([
      "S1 captured · T1 started",
    ]);
  });

  it("claims no screenshot for a task the stream does not tie to one", () => {
    expect(
      taskMarkers(input([answerAction(answerResult())])).map(
        (marker) => marker.text,
      ),
    ).toEqual(["T1 started"]);
  });

  it("marks a task the owner stopped, and what was and was not published", () => {
    const texts = taskMarkers(input([stopped("task-2")])).map(
      (marker) => marker.text,
    );
    expect(texts).toEqual([
      "T1 started",
      "T1 stopped by you · nothing published",
    ]);
    expect(
      taskMarkers(input([first, stopped("task-1", "solve-code")])).map(
        (marker) => marker.text,
      ),
    ).toContain("T1 stopped by you · nothing published for code");
  });

  it("puts the markers among the rows in time order, and drops the cleared ones", () => {
    const model = modelOf([first]);
    const markers = taskMarkers({
      tasks: model.tasks,
      actions: [first],
      observations: [snapshot(1)],
      deviceOnly: false,
    });
    const rows = panelRows(model, [], [], 0, markers);
    expect(rows.some((row) => row.kind === "marker")).toBe(true);
    expect(
      panelRows(model, [], [], Date.parse(minutesAfter(5)), markers).some(
        (row) => row.kind === "marker",
      ),
    ).toBe(false);
  });
});

describe("what the owner stopped", () => {
  it("knows a task whose runs the owner stopped, and no other", () => {
    expect(stoppedByYou(modelOf([stopped("task-1")]).tasks[0] as never)).toBe(
      true,
    );
    expect(stoppedByYou(modelOf([first]).tasks[0] as never)).toBe(false);
  });
});

describe("task chips", () => {
  it("numbers and names each task, marking the one on show and the newest", () => {
    const model = modelOf([
      first,
      answerAction(answerResult(), {
        taskId: "task-2",
        createdAt: minutesAfter(1, 8),
        updatedAt: minutesAfter(1, 9),
      }),
    ]);
    const chips = taskChips(model.tasks, "task-1");
    expect(
      chips.map((chip) => [chip.label, chip.selected, chip.newest]),
    ).toEqual([
      ["T1", true, false],
      ["T2", false, true],
    ]);
    expect(chips[0]?.text).toBe("T1 · Rate limiter");
  });
});

describe("the follow-up box", () => {
  it("names the task its text is about", () => {
    expect(followUpPlaceholder("T2")).toBe(
      "Add context to T2, or ask a follow-up",
    );
    expect(followUpPlaceholder(null)).toBe("Ask anything, or add context");
  });
});

describe("code placeholders", () => {
  const cardOf = (actions: ReturnType<typeof action>[], deviceOnly = false) => {
    const model = modelOf(actions);
    return taskCardModel({
      tasks: model.tasks,
      actions,
      observations: [snapshot(1)],
      selectedTaskId: null,
      deviceOnly,
    });
  };
  const place = (
    card: ReturnType<typeof cardOf>,
    extra: Partial<Parameters<typeof codePlaceholder>[0]> = {},
  ) =>
    codePlaceholder({
      card,
      approachPending: false,
      stoppedByYou: false,
      seconds: 0,
      ...extra,
    });

  it("waits for the approach before there is one, and before any task exists", () => {
    expect(place(null).text).toBe("Code appears once the approach is drafted.");
    expect(place(null, { approachPending: true }).text).toBe(
      "Starts automatically after the approach.",
    );
    expect(place(cardOf([first]), { approachPending: true }).text).toBe(
      "Starts automatically after the approach.",
    );
  });

  it("says it is writing code, with the real seconds once there are a few", () => {
    const writing = cardOf([
      first,
      action({
        actionKind: "solve-code",
        dispatchStatus: "in_flight",
        result: null,
        createdAt: minutesAfter(1, 6),
      }),
    ]);
    expect(place(writing)).toEqual({ text: "Writing code…", busy: true });
    expect(place(writing, { seconds: 7 }).text).toBe("Writing code… 7s");
  });

  it("says why code is not available, and when the owner stopped it", () => {
    expect(place(cardOf([first], true)).text).toBe(
      "Device-only mode: the code runner does not run on this Mac.",
    );
    const cancelled = cardOf([
      first,
      action({
        actionKind: "solve-code",
        dispatchStatus: "suppressed",
        suppressionReason: "owner_stopped",
      }),
    ]);
    expect(place(cancelled, { stoppedByYou: true }).text).toBe(
      "Stopped before code was written.",
    );
  });
});

describe("one bubble per sentence: new words merge in and mark it edited", () => {
  const piece = (at: number, text: string, source = "microphone") => ({
    key: `h-${at}`,
    source: source as "microphone",
    text,
    at,
  });
  it("shows the first words at once, unmarked", () => {
    const [group] = groupHeard([piece(1_000, "Just to kick things off")]);
    expect(group).toMatchObject({
      text: "Just to kick things off",
      edited: false,
      at: 1_000,
      lastAt: 1_000,
    });
  });
  it("merges the rest of the sentence into the same bubble, with a comma where the first was cut off, marked edited with the newest time", () => {
    const groups = groupHeard([
      piece(1_000, "Just to kick things off"),
      piece(
        3_000,
        "I would like to understand why you're interested in the role with Zensurance?",
      ),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      text: "Just to kick things off, I would like to understand why you're interested in the role with Zensurance?",
      edited: true,
      at: 1_000,
      lastAt: 3_000,
    });
  });
  it("keeps two speakers, and a finished sentence followed by a pause, in separate bubbles", () => {
    const groups = groupHeard([
      piece(1_000, "Thanks for joining."),
      piece(2_000, "Mm-hmm.", "application-audio"),
      piece(9_000, "So, tell me about your background."),
    ]);
    expect(groups.map((group) => group.text)).toEqual([
      "Thanks for joining.",
      "Mm-hmm.",
      "So, tell me about your background.",
    ]);
    expect(groups.some((group) => group.edited)).toBe(false);
  });
  it("does not run a finished sentence into a new one that follows after a pause", () => {
    expect(
      groupHeard([
        piece(1_000, "That was my last role."),
        piece(5_000, "What else?"),
      ]),
    ).toHaveLength(2);
  });
  it("puts the edited mark and the newest time on the row", () => {
    const model = modelOf(
      [],
      [
        snapshot(1),
        transcript(2, "Just to kick things off", {
          sourceId: "microphone-run1",
        }),
        transcript(3, "I would like to hear about you?", {
          sourceId: "microphone-run1",
        }),
      ],
    );
    const [row] = panelRows(model, []);
    expect(row).toMatchObject({ edited: true });
    expect(row?.shownAt).toBeGreaterThan(row?.at ?? 0);
  });
});
