import type { CoachNote } from "@omnitech/interview-contracts";
import { describe, expect, it } from "vitest";
import {
  asksSomething,
  conversationTurns,
  currentQuestion,
  echoes,
  heardEmphasis,
  questionsOf,
  waitingTurn,
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
  kind: "direct-answer",
  revision: 1,
  status: "ready",
  points: [],
  sections: [],
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

  it("a note posted before the first question is never filed under it: it is a question of its own, and the one just asked waits", () => {
    const turns = conversationTurns(
      [heard("interviewer", 30, QUESTION_ONE)],
      [note(5, "Opening line")],
    );
    const questions = questionsOf(turns);

    expect(
      questions.map((each) => [each.number, each.label, each.notes.length]),
    ).toEqual([[1, "Opening line", 1]]);
    expect(questions[0]?.question).toBeNull();
    expect(questions[0]?.live).toBe(true);
    expect(waitingTurn(turns)?.question?.text).toBe(QUESTION_ONE);
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

describe("where a note is filed", () => {
  const rows = [
    heard("interviewer", 0, QUESTION_ONE),
    heard("interviewer", 60, QUESTION_TWO),
  ];
  const shape = (turns: ReturnType<typeof conversationTurns>) =>
    turns.map((turn) => [
      turn.key,
      turn.question?.text ?? null,
      turn.notes.map((each) => each.title),
    ]);

  it("under the last question asked before it, when the coach has filed nothing else there", () => {
    expect(
      shape(conversationTurns(rows, [note(20, "First", { askId: "a" })])),
    ).toEqual([
      ["interviewer-0", QUESTION_ONE, ["First"]],
      ["interviewer-60", QUESTION_TWO, []],
    ]);
  });

  it("a question asked at the very moment of the note counts as asked before it", () => {
    expect(
      conversationTurns(rows, [note(60, "On the dot")]).map(
        (turn) => turn.notes.length,
      ),
    ).toEqual([0, 1]);
  });

  it("in a turn of its own when that question already holds notes for another ask: no question's notes pile onto another", () => {
    const turns = conversationTurns(rows, [
      note(20, "First", { askId: "a" }),
      note(30, "A rephrasing the transcript missed", {
        askId: "b",
        ask: "Splitting by team",
      }),
    ]);

    // The new turn is led by the note: no heard question, the note's time,
    // keyed by the ask, and in its place in time.
    expect(shape(turns)).toEqual([
      ["interviewer-0", QUESTION_ONE, ["First"]],
      ["ask-b", null, ["A rephrasing the transcript missed"]],
      ["interviewer-60", QUESTION_TWO, []],
    ]);
    expect(turns[1]?.at).toBe(T0 + 30_000);
    expect(turns[1]?.ask).toBe("Splitting by team");
    expect(turns[1]).toMatchObject({ asides: [], studio: [], mine: [] });
  });

  it("a later note for that ask joins the turn it opened, however late and whatever was asked since", () => {
    const turns = conversationTurns(rows, [
      note(20, "First", { askId: "a" }),
      note(30, "Opened it", { askId: "b" }),
      note(90, "Joins it", { askId: "b" }),
    ]);

    expect(shape(turns)).toEqual([
      ["interviewer-0", QUESTION_ONE, ["First"]],
      ["ask-b", null, ["Opened it", "Joins it"]],
      ["interviewer-60", QUESTION_TWO, []],
    ]);
  });

  it("a note-led turn is the nearest for what comes next: an unnamed note joins it, another ask opens one more", () => {
    const turns = conversationTurns(rows, [
      note(20, "First", { askId: "a" }),
      note(30, "Second ask", { askId: "b" }),
      note(40, "Unnamed"),
      note(45, "Third ask", { askId: "c" }),
    ]);

    expect(shape(turns)).toEqual([
      ["interviewer-0", QUESTION_ONE, ["First"]],
      ["ask-b", null, ["Second ask", "Unnamed"]],
      ["ask-c", null, ["Third ask"]],
      ["interviewer-60", QUESTION_TWO, []],
    ]);
  });

  it("a note with no ask id never opens a turn beside a question: it joins the nearest, whatever that holds", () => {
    const turns = conversationTurns(rows, [
      note(20, "First", { askId: "a" }),
      note(30, "Unnamed"),
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0]?.notes.map((each) => each.title)).toEqual([
      "First",
      "Unnamed",
    ]);
  });

  it("a named note joins a question that so far holds only unnamed notes", () => {
    const turns = conversationTurns(rows, [
      note(20, "Unnamed"),
      note(30, "Named", { askId: "a" }),
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0]?.notes.map((each) => each.title)).toEqual([
      "Unnamed",
      "Named",
    ]);
  });

  it("opens a turn keyed by the ask when nothing was asked before it, ahead of the first question", () => {
    const turns = conversationTurns(
      [heard("interviewer", 30, QUESTION_ONE)],
      [note(5, "Opening line", { askId: "intro" })],
    );

    expect(shape(turns)).toEqual([
      ["ask-intro", null, ["Opening line"]],
      ["interviewer-30", QUESTION_ONE, []],
    ]);
  });

  it("opens a turn keyed by the note itself when it names no ask", () => {
    const early = note(5, "Opening line");
    const turns = conversationTurns(
      [heard("interviewer", 30, QUESTION_ONE)],
      [early],
    );

    expect(turns.map((turn) => turn.key)).toEqual([
      `note-${early.id}`,
      "interviewer-30",
    ]);
    // The next unnamed note before the question joins it; it opens no second turn.
    expect(
      conversationTurns(
        [heard("interviewer", 30, QUESTION_ONE)],
        [early, note(9, "Then your stack")],
      ).map((turn) => turn.notes.length),
    ).toEqual([2, 0]);
  });

  it("the turn that waits before the first question (a greeting) takes a note posted after it", () => {
    const turns = conversationTurns(
      [
        heard("interviewer", 0, "Hi there, thanks for joining us today"),
        heard("interviewer", 30, QUESTION_ONE),
      ],
      [note(5, "Opening line")],
    );

    expect(turns.map((turn) => [turn.key, turn.notes.length])).toEqual([
      ["before", 1],
      ["interviewer-30", 0],
    ]);
  });
});

describe("questionsOf: rephrasings and follow-ups", () => {
  const FOLLOW_UP = "And how would you test that in production";
  const THIRD = "Tell me about a project you are proud of";

  it("a question the coach did not answer, asked before the last answered one, is a follow-up of the question before it", () => {
    const questions = questionsOf(
      conversationTurns(
        [
          heard("interviewer", 0, QUESTION_ONE),
          heard("you", 10, "I default to the monolith unless it earns it"),
          heard("interviewer", 30, FOLLOW_UP),
          heard("you", 40, "With a canary and a synthetic probe on it"),
          heard("interviewer", 45, "OK sounds good"),
          heard("interviewer", 60, QUESTION_TWO),
        ],
        [note(5, "Name the criteria"), note(70, "Name the techniques")],
      ),
    );

    expect(
      questions.map((each) => [each.number, each.question?.text, each.live]),
    ).toEqual([
      [1, QUESTION_ONE, false],
      [2, QUESTION_TWO, true],
    ]);
    expect(questions[0]?.followUps.map((row) => row.text)).toEqual([FOLLOW_UP]);
    // What was said and heard under the follow-up goes with it, in order.
    expect(questions[0]?.mine.map((row) => row.text)).toEqual([
      "I default to the monolith unless it earns it",
      "With a canary and a synthetic probe on it",
    ]);
    expect(questions[0]?.asides.map((row) => row.text)).toEqual([
      "OK sounds good",
    ]);
    expect(questions[1]?.followUps).toEqual([]);
  });

  it("carries the studio's answer to a follow-up to the question it was folded into", () => {
    const answer: PanelRow = {
      key: "a-task-2",
      kind: "assistant",
      label: "Studio · T2",
      text: "Canary first.",
      at: T0 + 35_000,
      taskId: "task-2",
    };
    const [first] = questionsOf(
      conversationTurns(
        [
          heard("interviewer", 0, QUESTION_ONE),
          heard("interviewer", 30, FOLLOW_UP),
          answer,
          heard("interviewer", 60, QUESTION_TWO),
        ],
        [note(5, "Name the criteria"), note(70, "Name the techniques")],
      ),
    );

    expect(first?.studio).toEqual([answer]);
  });

  it("several in a row all fold into the same question, oldest first", () => {
    const [first, second] = questionsOf(
      conversationTurns(
        [
          heard("interviewer", 0, QUESTION_ONE),
          heard("interviewer", 20, FOLLOW_UP),
          heard("interviewer", 40, THIRD),
          heard("interviewer", 60, QUESTION_TWO),
        ],
        [note(5, "First"), note(70, "Second")],
      ),
    );

    expect(first?.followUps.map((row) => row.text)).toEqual([FOLLOW_UP, THIRD]);
    expect(second?.number).toBe(2);
  });

  it("of the questions asked after the last answered one, only the newest waits: the others are follow-ups too", () => {
    const turns = conversationTurns(
      [
        heard("interviewer", 0, QUESTION_ONE),
        heard("interviewer", 30, FOLLOW_UP),
        heard("interviewer", 60, QUESTION_TWO),
      ],
      [note(5, "Name the criteria")],
    );
    const questions = questionsOf(turns);

    expect(questions.map((each) => each.question?.text)).toEqual([
      QUESTION_ONE,
    ]);
    expect(questions[0]?.followUps.map((row) => row.text)).toEqual([FOLLOW_UP]);
    expect(questions[0]?.live).toBe(true);
    expect(waitingTurn(turns)?.question?.text).toBe(QUESTION_TWO);
  });

  it("the question that waits is in no row and under no question: nothing of it is folded", () => {
    const turns = conversationTurns(
      [
        heard("interviewer", 0, QUESTION_ONE),
        heard("interviewer", 60, QUESTION_TWO),
        heard("you", 70, "We detect an identical correlation ID and skip it"),
        heard("interviewer", 80, "OK sounds good"),
      ],
      [note(5, "Name the criteria")],
    );
    const [only, ...rest] = questionsOf(turns);

    expect(rest).toEqual([]);
    expect(only).toMatchObject({ followUps: [], mine: [], asides: [] });
  });

  it("with no notes at all, every question is its own row", () => {
    const questions = questionsOf(
      conversationTurns(
        [
          heard("interviewer", 0, QUESTION_ONE),
          heard("interviewer", 30, FOLLOW_UP),
        ],
        [],
      ),
    );

    expect(questions.map((each) => each.followUps)).toEqual([[], []]);
  });

  it("a question asked before the coach's first note has nothing to hang on: it has no row", () => {
    const questions = questionsOf(
      conversationTurns(
        [
          heard("interviewer", 0, QUESTION_ONE),
          heard("you", 10, "I default to the monolith unless it earns it"),
          heard("interviewer", 60, QUESTION_TWO),
        ],
        [note(70, "Name the techniques")],
      ),
    );

    expect(
      questions.map((each) => [
        each.number,
        each.question?.text,
        each.notes.length,
      ]),
    ).toEqual([[1, QUESTION_TWO, 1]]);
    expect(questions[0]).toMatchObject({ followUps: [], mine: [] });
  });

  it("once a coach is writing, every row has notes", () => {
    const questions = questionsOf(
      conversationTurns(
        [
          heard("interviewer", 0, QUESTION_ONE),
          heard("interviewer", 20, FOLLOW_UP),
          heard("interviewer", 60, QUESTION_TWO),
          heard("interviewer", 120, THIRD),
        ],
        [note(5, "First"), note(70, "Second", { askId: "b" })],
      ),
    );

    expect(questions.map((each) => each.number)).toEqual([1, 2]);
    expect(questions.every((each) => each.notes.length > 0)).toBe(true);
    expect(questions.map((each) => each.live)).toEqual([false, true]);
  });

  it("a greeting before the first question is not a question and is not folded into one", () => {
    const questions = questionsOf(
      conversationTurns(
        [
          heard("interviewer", 0, "Hi there, thanks for joining us today"),
          heard("interviewer", 30, QUESTION_ONE),
        ],
        [note(40, "Name the criteria")],
      ),
    );

    expect(questions).toHaveLength(1);
    expect(questions[0]?.asides).toEqual([]);
    expect(questions[0]?.followUps).toEqual([]);
  });

  it("folds into a question the coach opened with a note, too", () => {
    const questions = questionsOf(
      conversationTurns(
        [
          heard("interviewer", 0, QUESTION_ONE),
          heard("interviewer", 40, FOLLOW_UP),
          heard("interviewer", 60, QUESTION_TWO),
        ],
        [
          note(10, "First", { askId: "a" }),
          note(20, "Rephrased", { askId: "b", ask: "Splitting by team" }),
          note(70, "Second", { askId: "c" }),
        ],
      ),
    );

    expect(questions.map((each) => each.label)).toEqual([
      QUESTION_ONE,
      "Splitting by team",
      QUESTION_TWO,
    ]);
    expect(questions[1]?.followUps.map((row) => row.text)).toEqual([FOLLOW_UP]);
  });

  it("leaves the turns it was given as they were", () => {
    const turns = conversationTurns(
      [
        heard("interviewer", 0, QUESTION_ONE),
        heard("interviewer", 30, FOLLOW_UP),
        heard("you", 40, "With a canary and a synthetic probe on it"),
        heard("interviewer", 60, QUESTION_TWO),
      ],
      [note(5, "First"), note(70, "Second")],
    );
    const before = structuredClone(turns);
    questionsOf(turns);

    expect(turns).toEqual(before);
  });
});

describe("waitingTurn: the question just asked that the coach has not answered", () => {
  const rows = [
    heard("interviewer", 0, QUESTION_ONE),
    heard("interviewer", 60, QUESTION_TWO),
  ];

  it("is the last question, when it was asked after the last one that has notes", () => {
    const turns = conversationTurns(rows, [note(5, "First")]);

    expect(waitingTurn(turns)).toBe(turns[1]);
    expect(waitingTurn(turns)?.question?.text).toBe(QUESTION_TWO);
  });

  it("is only ever the last one, however many were asked since the last note", () => {
    const turns = conversationTurns(
      [
        ...rows,
        heard("interviewer", 120, "Tell me about a project you are proud of"),
      ],
      [note(5, "First")],
    );

    expect(waitingTurn(turns)).toBe(turns[2]);
  });

  it("is none once the last question has notes", () => {
    expect(
      waitingTurn(
        conversationTurns(rows, [note(5, "First"), note(70, "Second")]),
      ),
    ).toBeUndefined();
  });

  it("is none where no coach has written a note: every question is listed instead", () => {
    const turns = conversationTurns(rows, []);

    expect(waitingTurn(turns)).toBeUndefined();
    expect(questionsOf(turns)).toHaveLength(2);
  });

  it("is none when the last turn is one a note opened, or when there is nothing at all", () => {
    expect(
      waitingTurn(
        conversationTurns(rows, [
          note(70, "Second", { askId: "a" }),
          note(90, "A rephrasing", { askId: "b" }),
        ]),
      ),
    ).toBeUndefined();
    expect(waitingTurn([])).toBeUndefined();
    expect(
      waitingTurn(conversationTurns([], [note(5, "Opening line")])),
    ).toBeUndefined();
  });

  it("comes into the list, as the live question, when its notes arrive", () => {
    const turns = conversationTurns(rows, [
      note(5, "First"),
      note(70, "Second"),
    ]);

    expect(
      questionsOf(turns).map((each) => [each.question?.text, each.live]),
    ).toEqual([
      [QUESTION_ONE, false],
      [QUESTION_TWO, true],
    ]);
  });
});

describe("heardEmphasis: the words that carry what was heard", () => {
  const strong = (text: string) =>
    heardEmphasis(text)
      .filter((piece) => piece.strong)
      .map((piece) => piece.text);

  it("lifts a word of five letters or more, and leaves the shorter ones quiet", () => {
    expect(heardEmphasis("Tell me why teams split")).toEqual([
      { text: "Tell me why ", strong: false },
      { text: "teams split", strong: true },
    ]);
    // Four letters are not enough; five are.
    expect(strong("team teams")).toEqual(["teams"]);
  });

  it("leaves a long word quiet when it only joins the sentence", () => {
    expect(
      heardEmphasis("you know there would be behavioural challenges"),
    ).toEqual([
      { text: "you know there would be ", strong: false },
      { text: "behavioural challenges", strong: true },
    ]);
    for (const quiet of [
      "about",
      "because",
      "really",
      "something",
      "should",
      "through",
      "usually",
      "actually",
      "basically",
      "sounds",
      "great",
    ])
      expect(strong(`so ${quiet} then`)).toEqual([]);
  });

  it("counts letters and apostrophes only, whatever the case and the punctuation round the word", () => {
    expect(strong("PEOPLE, (teams). a-b-c-d x1y2z3")).toEqual([
      "PEOPLE, (teams). ",
    ]);
    // An apostrophe counts toward the five: "don't" carries, "it's" does not.
    expect(strong("it's fine")).toEqual([]);
    expect(strong("so don't go")).toEqual(["don't "]);
    // A quiet word is quiet in any case, and with punctuation on it.
    expect(strong("Because, WOULD: There!")).toEqual([]);
    // Letters outside a to z do not count toward the five.
    expect(strong("naïve café")).toEqual([]);
    // Digits and marks alone are never lifted.
    expect(strong("12345 ----- 2026-10-08")).toEqual([]);
  });

  it("joins neighbours of the same weight, and the spaces between, into one piece", () => {
    expect(heardEmphasis("people challenges and the teams")).toEqual([
      { text: "people challenges ", strong: true },
      { text: "and the ", strong: false },
      { text: "teams", strong: true },
    ]);
    // The space after a piece goes with it, whatever follows.
    expect(heardEmphasis("a people a")).toEqual([
      { text: "a ", strong: false },
      { text: "people ", strong: true },
      { text: "a", strong: false },
    ]);
  });

  it.each([
    "How do you handle data consistency between multiple services?",
    "  leading and   trailing spaces, kept  ",
    "one\ttab and a\nnew line between people",
    "people",
    "a",
    "   ",
    "",
    "don't — “quoted” words… and 100% numbers",
  ])("the pieces joined are exactly what was heard: %j", (text) => {
    expect(
      heardEmphasis(text)
        .map((piece) => piece.text)
        .join(""),
    ).toBe(text);
  });

  it("no two neighbouring pieces have the same weight, and none is empty", () => {
    const pieces = heardEmphasis(
      "So you know there would be behavioural challenges with people and their teams usually",
    );
    expect(pieces.length).toBeGreaterThan(2);
    for (const [at, piece] of pieces.entries()) {
      expect(piece.text).not.toBe("");
      if (at > 0) expect(piece.strong).not.toBe(pieces[at - 1]?.strong);
    }
  });

  it("is nothing for nothing, and one quiet piece for space alone or a single short word", () => {
    expect(heardEmphasis("")).toEqual([]);
    expect(heardEmphasis("   ")).toEqual([{ text: "   ", strong: false }]);
    expect(heardEmphasis("why")).toEqual([{ text: "why", strong: false }]);
    expect(heardEmphasis("people")).toEqual([{ text: "people", strong: true }]);
  });

  it("leading space is a quiet piece of its own before a word that carries", () => {
    expect(heardEmphasis("  people")).toEqual([
      { text: "  ", strong: false },
      { text: "people", strong: true },
    ]);
  });
});
