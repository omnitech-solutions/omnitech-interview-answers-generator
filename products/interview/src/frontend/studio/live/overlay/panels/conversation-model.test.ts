import type { CoachNote } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  asksSomething,
  conversationTurns,
  currentQuestion,
  echoes,
  questionsOf,
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
const note = (
  seconds: number,
  title: string,
  extra: Partial<CoachNote> = {},
): CoachNote => ({
  id: `00000000-0000-4000-8000-${String(seconds).padStart(12, "0")}`,
  createdAt: new Date(T0 + seconds * 1000).toISOString(),
  title,
  tone: "say",
  points: [],
  links: [],
  ...extra,
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

describe("asksSomething", () => {
  it.each([
    ["a question word", QUESTION_ONE],
    [
      "a question put to the person",
      "Have you worked with event sourcing before",
    ],
    ["a request", "Tell me about a project you are proud of"],
    [
      "a request to walk through",
      "Please walk us through your last system design",
    ],
    [
      "a request to describe",
      "Describe the hardest production incident you handled",
    ],
    ["an invitation to ask", "So do you have any questions for me"],
    ["whatever the case", "WHY did you choose Postgres over DynamoDB"],
  ])("is true for %s", (_name, text) => {
    expect(asksSomething(text)).toBe(true);
  });

  it.each([
    ["a thank-you", "Thank you so much for your time today"],
    ["a closing remark", "Great, that is everything from my side then"],
    ["an acknowledgement", "OK that makes a lot of sense, good"],
    ["a line under five words, even with a question word", "And why exactly"],
    ["a request too short to be one", "Tell me more"],
    ["nothing", ""],
  ])("is false for %s", (_name, text) => {
    expect(asksSomething(text)).toBe(false);
  });

  it("counts five words as enough", () => {
    expect(asksSomething("How would you test it")).toBe(true);
    expect(asksSomething("How would you test")).toBe(false);
  });
});

describe("closing remarks and thank-yous", () => {
  const THANKS = "Thank you so much for your time today";
  const CLOSING = "Great, that is everything from my side then";

  it("are asides of the question they follow, never questions of their own", () => {
    const turns = conversationTurns(
      [
        heard("interviewer", 0, QUESTION_ONE),
        heard(
          "you",
          10,
          "I default to the monolith unless a boundary earns it",
        ),
        heard("interviewer", 40, CLOSING),
        heard("interviewer", 50, THANKS),
      ],
      [],
    );

    expect(turns).toHaveLength(1);
    expect(turns[0]?.asides.map((row) => row.text)).toEqual([CLOSING, THANKS]);
    expect(currentQuestion(turns)?.text).toBe(QUESTION_ONE);
    expect(questionsOf(turns).map((each) => each.label)).toEqual([
      QUESTION_ONE,
    ]);
  });

  it("keep a note posted after them under the question that was asked", () => {
    const turns = conversationTurns(
      [heard("interviewer", 0, QUESTION_ONE), heard("interviewer", 40, THANKS)],
      [note(45, "Close with the trade-off")],
    );

    expect(turns).toHaveLength(1);
    expect(turns[0]?.notes.map((each) => each.title)).toEqual([
      "Close with the trade-off",
    ]);
  });

  it("heard before any question wait in a turn with no question", () => {
    const turns = conversationTurns(
      [
        heard("interviewer", 0, "Hi there, thanks for joining us today"),
        heard("interviewer", 30, QUESTION_ONE),
      ],
      [],
    );

    expect(turns.map((turn) => turn.question?.text ?? null)).toEqual([
      null,
      QUESTION_ONE,
    ]);
    expect(turns[0]?.key).toBe("before");
    expect(turns[0]?.asides).toHaveLength(1);
    // Nothing was asked or noted there, so it is not listed as a question.
    expect(questionsOf(turns).map((each) => each.number)).toEqual([1]);
  });
});

describe("a note that names its question (askId)", () => {
  const rows = [
    heard("interviewer", 0, QUESTION_ONE),
    heard("interviewer", 60, QUESTION_TWO),
  ];

  it("joins the turn that already holds a note with the same id, however late it is posted", () => {
    const turns = conversationTurns(rows, [
      note(20, "Monolith or service", { askId: "q-monolith" }),
      note(80, "Consistency", { askId: "q-consistency" }),
      note(90, "Follow-up: team size", { askId: "q-monolith" }),
    ]);

    expect(turns.map((turn) => turn.notes.map((each) => each.title))).toEqual([
      ["Monolith or service", "Follow-up: team size"],
      ["Consistency"],
    ]);
  });

  it("goes by time when no note with its id has been filed yet", () => {
    const turns = conversationTurns(rows, [
      note(80, "Consistency", { askId: "q-consistency" }),
    ]);

    expect(turns.map((turn) => turn.notes.length)).toEqual([0, 1]);
  });

  it("is filed in posting order, whatever order the notes arrive in", () => {
    const turns = conversationTurns(rows, [
      note(90, "Follow-up: team size", { askId: "q-monolith" }),
      note(20, "Monolith or service", { askId: "q-monolith" }),
    ]);

    expect(turns[0]?.notes.map((each) => each.title)).toEqual([
      "Monolith or service",
      "Follow-up: team size",
    ]);
    expect(turns[1]?.notes).toEqual([]);
  });

  it("with no id goes by time, even beside notes that have one", () => {
    const turns = conversationTurns(rows, [
      note(20, "Monolith or service", { askId: "q-monolith" }),
      note(90, "Mention the Outbox"),
    ]);

    expect(turns.map((turn) => turn.notes.map((each) => each.title))).toEqual([
      ["Monolith or service"],
      ["Mention the Outbox"],
    ]);
  });

  it("gathers under one turn before anything is heard", () => {
    const turns = conversationTurns(
      [],
      [
        note(5, "Opening line", { askId: "intro" }),
        note(9, "Then your stack", { askId: "intro" }),
      ],
    );

    expect(turns).toHaveLength(1);
    expect(turns[0]?.notes).toHaveLength(2);
  });
});

describe("the coach's restatement (ask)", () => {
  it("is the turn's ask and its label in the questions list", () => {
    const turns = conversationTurns(
      [heard("interviewer", 0, QUESTION_ONE)],
      [note(20, "Name the criteria", { ask: "Monolith or microservice" })],
    );

    expect(turns[0]?.ask).toBe("Monolith or microservice");
    expect(questionsOf(turns)[0]?.label).toBe("Monolith or microservice");
    // What was heard is still the question itself.
    expect(questionsOf(turns)[0]?.question?.text).toBe(QUESTION_ONE);
  });

  it("is null until a note carries one, and a later note without one leaves it", () => {
    const rows = [heard("interviewer", 0, QUESTION_ONE)];
    expect(conversationTurns(rows, [note(20, "First")])[0]?.ask).toBeNull();
    expect(
      conversationTurns(rows, [
        note(20, "First", { ask: "Monolith or microservice" }),
        note(30, "Second"),
      ])[0]?.ask,
    ).toBe("Monolith or microservice");
  });

  it("the newest note's wording stands", () => {
    const turns = conversationTurns(
      [heard("interviewer", 0, QUESTION_ONE)],
      [
        note(20, "First", { ask: "Microservices", askId: "q1" }),
        note(30, "Second", { ask: "When to split a service", askId: "q1" }),
      ],
    );

    expect(turns[0]?.ask).toBe("When to split a service");
  });

  it("names the follow-up's turn, not the turn on the table", () => {
    const turns = conversationTurns(
      [
        heard("interviewer", 0, QUESTION_ONE),
        heard("interviewer", 60, QUESTION_TWO),
      ],
      [
        note(20, "First", { ask: "Microservices", askId: "q1" }),
        note(90, "Second", { ask: "When to split a service", askId: "q1" }),
      ],
    );

    expect(turns.map((turn) => turn.ask)).toEqual([
      "When to split a service",
      null,
    ]);
  });
});

describe("questionsOf", () => {
  it("numbers the questions from 1 in the order asked; only the last is live", () => {
    const questions = questionsOf(
      conversationTurns(
        [
          heard("interviewer", 0, QUESTION_ONE),
          heard("interviewer", 60, QUESTION_TWO),
          heard("interviewer", 120, "Tell me about a project you are proud of"),
        ],
        [],
      ),
    );

    expect(questions.map((each) => [each.number, each.live])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
    expect(questions.map((each) => each.key)).toEqual([
      "interviewer-0",
      "interviewer-60",
      "interviewer-120",
    ]);
  });

  it("is empty when nothing was asked or noted", () => {
    expect(questionsOf([])).toEqual([]);
    expect(
      questionsOf(
        conversationTurns([heard("you", 0, "Can you hear me all right")], []),
      ),
    ).toEqual([]);
  });

  it("lists notes with no question heard as one question, labelled by the first note's title", () => {
    const questions = questionsOf(
      conversationTurns([], [note(5, "Opening line"), note(9, "Your stack")]),
    );

    expect(
      questions.map((each) => [each.number, each.label, each.live]),
    ).toEqual([[1, "Opening line", true]]);
    expect(questions[0]?.question).toBeNull();
  });

  it("files a note posted just before the first question under that question", () => {
    const questions = questionsOf(
      conversationTurns(
        [heard("interviewer", 30, QUESTION_ONE)],
        [note(5, "Opening line")],
      ),
    );

    expect(questions.map((each) => [each.label, each.notes.length])).toEqual([
      [QUESTION_ONE, 1],
    ]);
  });

  it("keeps what each turn holds", () => {
    const [only] = questionsOf(
      conversationTurns(
        [
          heard("interviewer", 0, QUESTION_ONE),
          heard(
            "you",
            10,
            "I default to the monolith unless a boundary earns it",
          ),
        ],
        [note(20, "Monolith or service")],
      ),
    );

    expect(only?.notes).toHaveLength(1);
    expect(only?.mine).toHaveLength(1);
    expect(only?.at).toBe(T0);
  });

  it("shows a heard question of up to 60 characters whole", () => {
    const sixty = `How ${"a".repeat(11)} ${"b".repeat(11)} ${"c".repeat(11)} ${"d".repeat(20)}`;
    expect(sixty).toHaveLength(60);
    const [only] = questionsOf(
      conversationTurns([heard("interviewer", 0, sixty)], []),
    );

    expect(only?.label).toBe(sixty);
  });

  it("cuts a longer one to 60 characters and an ellipsis, with no space before it", () => {
    const long =
      "How would you design a rate limiter for a public API that many separate tenants share";
    const [only] = questionsOf(
      conversationTurns([heard("interviewer", 0, long)], []),
    );

    expect(only?.label).toBe(`${long.slice(0, 60).trimEnd()}…`);
    expect(only?.label.endsWith(" …")).toBe(false);
    expect(only?.label.length).toBeLessThanOrEqual(61);
    // The whole question is still there to show.
    expect(only?.question?.text).toBe(long);
  });

  it("never cuts the coach's own wording", () => {
    const ask = "c".repeat(80);
    const [only] = questionsOf(
      conversationTurns(
        [heard("interviewer", 0, QUESTION_ONE)],
        [note(10, "Title", { ask })],
      ),
    );

    expect(only?.label).toBe(ask);
  });
});
