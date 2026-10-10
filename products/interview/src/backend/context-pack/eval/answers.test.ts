import type { ContextRecord } from "@omnitech/ai-engine";
import { describe, expect, it } from "vitest";
import {
  answerTotals,
  figuresIn,
  promptFor,
  sample,
  scoreAnswer,
  scriptedAnswerer,
  verdict,
} from "./answers";
import type { Chosen } from "./arms";
import type { Question } from "./fixture";

const record = (
  id: string,
  text: string,
  company: string,
  kind = "candidate-achievement",
): ContextRecord =>
  ({
    id,
    kind,
    text,
    fields: { company },
    source: { id: "matrix", revision: "1", locator: `/roles/${id}` },
    hash: id,
  }) as ContextRecord;
const chosen = (each: ContextRecord): Chosen => ({
  id: each.id,
  slot: "evidence",
  kind: each.kind,
  text: each.text,
  score: 1,
  exact: false,
});
const KEYS = record(
  "a1",
  "At Orchard Clinics: added idempotency keys to the booking API, cutting double bookings by 65%.",
  "Orchard Clinics",
);
const OTHER = record(
  "a2",
  "At Palisade Dental: moved reminders to a queue; p99 fell to 120ms.",
  "Palisade Dental",
);
const records = new Map([KEYS, OTHER].map((each) => [each.id, each]));
const question: Question = {
  id: "q1",
  app: "tidewell-care",
  category: "paraphrase",
  question: "How do you stop a patient being booked twice?",
  gold: [{ id: "a1", grade: 2 }],
  points: [
    { says: "idempotency keys" },
    { says: "65%", aliases: ["65 percent"] },
  ],
  employers: ["Orchard Clinics"],
};
const ENTITIES = ["Orchard Clinics", "Palisade Dental", "Wrenfield Labs"];
const score = (
  answer: { answer: string; cites: string[]; abstain: boolean } | null,
  asked: Question = question,
  given = [KEYS, OTHER],
) => {
  const prompt = promptFor(asked, given.map(chosen), records);
  return scoreAnswer({
    question: asked,
    arm: "pack",
    answer,
    given: prompt.given,
    entities: ENTITIES,
    usage: { inputTokens: 100, outputTokens: 20 },
    ms: 1200,
    cut: prompt.cut,
  });
};

describe("an answer is scored in code", () => {
  it("counts the gold points stated, by the source's words or an alias", () => {
    const right = score({
      answer:
        "At Orchard Clinics I added idempotency keys to the booking API, which cut double bookings by 65 percent.",
      cites: ["R1"],
      abstain: false,
    });
    expect(right).toMatchObject({
      points: 2,
      pointsOf: 2,
      cites: 1,
      citesExist: 1,
      citesGold: 1,
      citesWrongEmployer: 0,
      unsupported: [],
      abstained: false,
      shouldAbstain: false,
    });
    expect(verdict(right)).toBe(true);
  });

  it("catches a figure and an employer nothing given says", () => {
    const invented = score({
      answer:
        "At Wrenfield Labs I added idempotency keys and cut double bookings by 80%.",
      cites: ["R1"],
      abstain: false,
    });
    expect(invented.unsupported).toEqual(["80%", "Wrenfield Labs"]);
    expect(verdict(invented)).toBe(false);
  });

  it("does not call a restated figure invented, however it is spaced", () => {
    expect(
      score({
        answer: "p99 fell to 120 milliseconds, and bookings fell 65 %.",
        cites: [],
        abstain: false,
      }).unsupported,
    ).toEqual([]);
    expect(
      figuresIn("two teams, 3 services, 14 minutes, p95, 2.4 million"),
    ).toEqual(["14minutes", "p95", "2.4million"]);
  });

  it("marks a cite of a wrong employer, and a cite of nothing given", () => {
    const wrong = score({
      answer: "I added idempotency keys; it was 65%.",
      cites: ["R2", "R9"],
      abstain: false,
    });
    expect(wrong).toMatchObject({
      cites: 2,
      citesExist: 1,
      citesWrongEmployer: 1,
      citesGold: 0,
    });
    expect(verdict(wrong)).toBe(false);
  });

  it("wants 'nothing covers it' exactly when nothing does", () => {
    const nothing: Question = {
      ...question,
      id: "q2",
      category: "unanswerable",
      question: "Have you shipped Elixir?",
      gold: [],
      points: [],
    };
    const said = score(
      {
        answer: "Nothing in the material covers it.",
        cites: [],
        abstain: true,
      },
      nothing,
    );
    expect(said.shouldAbstain).toBe(true);
    expect(verdict(said)).toBe(true);
    const made = score(
      { answer: "Yes, for two years.", cites: [], abstain: false },
      nothing,
    );
    expect(verdict(made)).toBe(false);
    // Saying nothing where the records answer is wrong too.
    expect(
      verdict(score({ answer: "Nothing.", cites: [], abstain: true })),
    ).toBe(false);
    // A call that failed is never right.
    expect(verdict(score(null))).toBe(false);
  });

  it("counts a device-only phrase the answer repeats", () => {
    const leak = score(
      { answer: "The band is 185 to 205.", cites: [], abstain: false },
      {
        ...question,
        id: "q3",
        category: "device-only",
        gold: [],
        points: [],
        absent: ["185 to 205"],
      },
    );
    expect(leak.leaked).toBe(1);
    expect(verdict(leak)).toBe(false);
  });

  it("totals an arm: right, invented, said nothing when it should", () => {
    const totals = answerTotals("pack", [
      score({
        answer: "At Orchard Clinics: idempotency keys, 65%.",
        cites: ["R1"],
        abstain: false,
      }),
      score({ answer: "It was 97%.", cites: [], abstain: false }),
      score(null),
    ]);
    expect(totals).toMatchObject({
      answers: 3,
      failed: 1,
      right: { right: 1, of: 3 },
      invented: { right: 1, of: 2 },
      wronglyAbstained: { right: 0, of: 2 },
    });
    expect(totals.points).toBe(0.5);
    expect(totals.inputTokens).toEqual({ median: 100, total: 200 });
  });
});

describe("the prompt and the sample", () => {
  it("shows each record once under a label, the question last, and cuts from the end", () => {
    const prompt = promptFor(
      { ...question, previous: "Tell me about booking." },
      [chosen(KEYS), chosen(KEYS), chosen(OTHER)],
      records,
      150,
    );
    expect(prompt.given.map((each) => each.label)).toEqual(["R1"]);
    expect(prompt.cut).toBe(1);
    expect(prompt.user).toContain(
      "[R1] (candidate-achievement; Orchard Clinics)",
    );
    expect(
      prompt.user.trimEnd().endsWith(`QUESTION: ${question.question}`),
    ).toBe(true);
    expect(prompt.user).toContain("THE QUESTION BEFORE THIS ONE");
    expect(promptFor(question, [], records).user).toContain("(none)");
  });

  it("samples every category, the same questions each time", () => {
    const many: Question[] = ["paraphrase", "temporal", "unanswerable"].flatMap(
      (category) =>
        [1, 2, 3].map((at) => ({
          ...question,
          id: `${category}-${at}`,
          category: category as Question["category"],
        })),
    );
    const picked = sample(many, 4);
    expect(picked).toHaveLength(4);
    expect(new Set(picked.map((each) => each.category)).size).toBe(3);
    expect(sample(many, 4)).toEqual(picked);
    expect(sample(many, 40)).toHaveLength(9);
  });

  it("has a scripted model that states only what it was given", async () => {
    const model = scriptedAnswerer();
    const given = promptFor(question, [chosen(KEYS)], records);
    const told = await model.ask({
      ...given,
      user: given.user.replace(question.question, "idempotency keys?"),
    });
    expect(told.value).toMatchObject({ cites: ["R1"], abstain: false });
    const none = await model.ask(promptFor(question, [], records));
    expect(none.value).toMatchObject({ abstain: true });
  });
});
