// The web Transcript shows a no-question capture as a small muted note, never
// as a task row or an answer, and collapses a run of them.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { deriveNoQuestionTasks, deriveTasks } from "./session-tasks";
import { transcriptRows } from "./session-transcript";
import { NO_QUESTION_NOTES, noQuestionNotes } from "./shared/no-question";
import {
  action,
  minutesAfter,
  stored,
  transcript,
} from "./testing/session-fixtures";
import { answerResult } from "./testing/session-result-fixtures";
import { TranscriptTab } from "./transcript-tab";

afterEach(cleanup);
const junk = (taskId: string, at: number) =>
  action({
    taskId,
    noQuestion: true,
    result: answerResult({ category: "no-question", draft: "Nothing here." }),
    createdAt: minutesAfter(at),
    sourceSnapshots: [{ sourceId: "screen", eventId: "e1" }],
  });

function show(count: number) {
  const actions = Array.from({ length: count }, (_v, i) =>
    junk(`x${i}`, i + 1),
  );
  const rows = transcriptRows(
    [],
    deriveTasks(actions, "active"),
    noQuestionNotes(deriveNoQuestionTasks(actions, "active"), actions),
  );
  render(
    <TranscriptTab
      rows={rows}
      sessionId="s"
      sessionStart={minutesAfter(0)}
      labels={{ snapshot: () => "S15", taskSnapshot: () => null }}
    />,
  );
}

describe("transcript note", () => {
  it("is one muted note with the screenshot label, not an answer", () => {
    show(1);
    const note = screen.getByTestId("transcript-note");
    expect(note).toHaveTextContent("S15 captured: no question found");
    expect(document.body).not.toHaveTextContent("Nothing here.");
    expect(screen.queryByText(/started/)).toBeNull();
  });

  it("collapses a run of notes into one line", () => {
    show(NO_QUESTION_NOTES.collapseAt);
    expect(screen.getAllByTestId("transcript-note")).toHaveLength(1);
    expect(screen.getByTestId("transcript-note")).toHaveTextContent(
      `${NO_QUESTION_NOTES.collapseAt} captures with no question`,
    );
  });
});

describe("an unreadable row", () => {
  it("is a visible placeholder, never silence, and never shows its content", () => {
    const bad = transcript(2, "SECRET WORDS", {
      sourceId: "owner-microphone",
      content: stored(2, {
        speaker: "microphone",
        text: "SECRET WORDS",
        startMs: 1234.56,
        endMs: 1234.56,
      }),
    });
    const rows = transcriptRows([transcript(1, "First line"), bad], [], []);
    render(
      <TranscriptTab
        rows={rows}
        sessionId="s"
        sessionStart={minutesAfter(0)}
        labels={{ snapshot: () => null, taskSnapshot: () => null }}
      />,
    );
    expect(screen.getAllByTestId("transcript-row")).toHaveLength(2);
    expect(screen.getByText(/A line could not be shown/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("SECRET WORDS");
  });
  it("is not invented for an unknown kind", () => {
    const rows = transcriptRows(
      [transcript(1, "x", { kind: "future.kind" as never })],
      [],
      [],
    );
    expect(rows).toHaveLength(0);
  });
});
