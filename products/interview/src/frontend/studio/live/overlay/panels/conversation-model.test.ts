import type { CoachNote } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  conversationTurns,
  currentQuestion,
  echoes,
} from "./conversation-model";
import type { PanelRow } from "./panel-model";

const T0 = Date.parse("2026-10-08T17:40:00.000Z");
const heard = (
  speaker: "interviewer" | "you",
  seconds: number,
  text: string,
): PanelRow => ({
  key: `${speaker}-${seconds}`,
  kind: "heard",
  speaker,
  label: speaker === "you" ? "You · mic" : "Interviewer · app audio",
  text,
  at: T0 + seconds * 1000,
});
const note = (seconds: number, title: string): CoachNote => ({
  id: `00000000-0000-4000-8000-${String(seconds).padStart(12, "0")}`,
  createdAt: new Date(T0 + seconds * 1000).toISOString(),
  title,
  tone: "say",
  points: [],
  links: [],
});

const QUESTION_ONE =
  "How do you decide when a feature should be a microservice";
const QUESTION_TWO =
  "How do you handle data consistency between multiple services";

describe("conversationTurns", () => {
  it("opens a turn per question and files what follows under it", () => {
    const turns = conversationTurns(
      [
        heard("interviewer", 0, QUESTION_ONE),
        heard(
          "you",
          10,
          "I default to the monolith unless a boundary earns it",
        ),
        heard("interviewer", 60, QUESTION_TWO),
        heard("you", 70, "We detect an identical correlation ID and skip it"),
      ],
      [note(20, "Monolith or service"), note(80, "Consistency")],
    );

    expect(turns.map((turn) => turn.question?.text)).toEqual([
      QUESTION_ONE,
      QUESTION_TWO,
    ]);
    expect(turns.map((turn) => turn.notes.map((each) => each.title))).toEqual([
      ["Monolith or service"],
      ["Consistency"],
    ]);
    expect(turns[0]?.mine.map((row) => row.text)).toEqual([
      "I default to the monolith unless a boundary earns it",
    ]);
    expect(currentQuestion(turns)?.text).toBe(QUESTION_TWO);
  });

  it("keeps a short interviewer line as an aside, not a new question", () => {
    const turns = conversationTurns(
      [
        heard("interviewer", 0, QUESTION_ONE),
        heard("interviewer", 30, "OK sounds good"),
      ],
      [],
    );

    expect(turns).toHaveLength(1);
    expect(turns[0]?.asides.map((row) => row.text)).toEqual(["OK sounds good"]);
  });

  it("leaves out the call heard again through the microphone", () => {
    const turns = conversationTurns(
      [
        heard("you", 1, `${QUESTION_ONE} yeah`),
        heard("interviewer", 0, QUESTION_ONE),
        heard("you", 12, "For me it depends on the business boundary"),
      ],
      [],
    );

    expect(turns[0]?.mine.map((row) => row.text)).toEqual([
      "For me it depends on the business boundary",
    ]);
  });

  it("holds a note that arrives before anything is heard", () => {
    const turns = conversationTurns([], [note(5, "Opening line")]);

    expect(turns).toHaveLength(1);
    expect(turns[0]?.question).toBeNull();
    expect(turns[0]?.notes.map((each) => each.title)).toEqual(["Opening line"]);
    expect(currentQuestion(turns)).toBeNull();
  });
});

describe("echoes", () => {
  it("is true when most of the shorter line is in the longer one", () => {
    expect(echoes(QUESTION_ONE, `um ${QUESTION_ONE} very good so`)).toBe(true);
  });

  it("is false for different lines and for lines too short to judge", () => {
    expect(echoes(QUESTION_ONE, QUESTION_TWO)).toBe(false);
    expect(echoes("sounds good", "OK sounds good")).toBe(false);
  });
});
