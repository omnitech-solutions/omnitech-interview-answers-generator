import { describe, expect, it } from "vitest";
import {
  briefingCategoryOf,
  briefRequestSchema,
  briefSchema,
  interviewPlanInputSchema,
  planItemInputSchema,
  planItemPatchSchema,
  planResponseSchema,
  rehearsalScore,
  rehearsalSessionInputSchema,
} from "./index.js";

describe("rehearsal contract", () => {
  it("scores ten per check, minus three per reveal, within 0..100", () => {
    expect(rehearsalScore(5, 2)).toBe(44);
    expect(rehearsalScore(1, 7)).toBe(0);
    expect(rehearsalScore(12, 0)).toBe(100);
  });

  const session = {
    format: "coding",
    strict: true,
    followUps: false,
    concept: null,
    coding: { source: "question", ref: "two-sum", title: "Two Sum" },
    checks: [0, 1, 2],
    reveals: ["hint1"],
    activeSeconds: 900,
    startedAt: "2026-10-01T10:00:00Z",
    endedAt: "2026-10-01T10:15:00+00:00",
  };

  it("accepts a finished session the client reports", () => {
    expect(rehearsalSessionInputSchema.parse(session)).toEqual(session);
  });

  it("refuses unknown reveals, over-long sessions and client-supplied scores", () => {
    expect(
      rehearsalSessionInputSchema.safeParse({ ...session, reveals: ["peek"] })
        .success,
    ).toBe(false);
    expect(
      rehearsalSessionInputSchema.safeParse({
        ...session,
        activeSeconds: 5 * 60 * 60,
      }).success,
    ).toBe(false);
    expect(
      rehearsalSessionInputSchema.safeParse({ ...session, score: 100 }).success,
    ).toBe(false);
  });
});

describe("interview plan contract", () => {
  it("trims an interview and bounds its duration and topics", () => {
    const parsed = interviewPlanInputSchema.parse({
      company: "  Acme  ",
      role: "Staff Engineer",
      scheduledAt: null,
      durationMinutes: 45,
      format: "Pairing",
      topics: ["React", "SQL"],
    });

    expect(parsed.company).toBe("Acme");
    expect(
      interviewPlanInputSchema.safeParse({ ...parsed, durationMinutes: 4 })
        .success,
    ).toBe(false);
    expect(
      interviewPlanInputSchema.safeParse({
        ...parsed,
        topics: Array.from({ length: 13 }, (_, index) => `t${index}`),
      }).success,
    ).toBe(false);
  });

  it("links plan items by kind and lets a patch change only title and done", () => {
    expect(
      planItemInputSchema.parse({
        kind: "question",
        ref: "two-sum",
        title: "Two Sum",
      }),
    ).toMatchObject({ kind: "question" });
    expect(
      planItemInputSchema.safeParse({ kind: "video", ref: null, title: "x" })
        .success,
    ).toBe(false);
    expect(planItemPatchSchema.safeParse({ done: true }).success).toBe(true);
    expect(planItemPatchSchema.safeParse({ kind: "task" }).success).toBe(false);
    expect(
      planResponseSchema.parse({
        interview: null,
        items: [
          {
            id: "item-1",
            kind: "task",
            ref: null,
            title: "Review notes",
            done: false,
            position: 0,
            status: { label: "5 of 6 tests passing", tone: "warn" },
          },
        ],
      }).items,
    ).toHaveLength(1);
  });
});

describe("concept brief contract", () => {
  const brief = {
    version: 1,
    headline: "Closures capture their lexical scope.",
    points: [
      { heading: "Scope", body: "Functions keep their defining scope." },
      { heading: "State", body: "Private state without classes." },
      { heading: "Cost", body: "Captured values stay alive." },
    ],
    example: "A counter factory.",
    pitfall: "Do not call every callback a closure.",
    followUps: [{ question: "Memory?", answer: "Release references." }],
  };

  it("requires exactly three points and at least one follow-up", () => {
    const stored = {
      id: "brief-1",
      kind: "concept",
      topic: "closures",
      title: "Closures",
      updatedAt: "2026-10-01T00:00:00Z",
      brief,
    };

    expect(briefSchema.parse(stored).brief.points).toHaveLength(3);
    expect(
      briefSchema.safeParse({
        ...stored,
        brief: { ...brief, points: brief.points.slice(0, 2) },
      }).success,
    ).toBe(false);
    expect(
      briefSchema.safeParse({ ...stored, brief: { ...brief, followUps: [] } })
        .success,
    ).toBe(false);
  });

  it("accepts concept and system-design requests only", () => {
    expect(
      briefRequestSchema.parse({ kind: "system-design", topic: " Caching " }),
    ).toEqual({ kind: "system-design", topic: "Caching" });
    expect(
      briefRequestSchema.safeParse({ kind: "trivia", topic: "x" }).success,
    ).toBe(false);
  });
});

describe("briefing question categories", () => {
  it.each([
    ["What are your salary expectations?", "logistics"],
    ["When could you start?", "logistics"],
    ["Do you have any questions for us?", "questions-to-ask"],
    ["Why do you want to join?", "motivation"],
    ["Tell me about a conflict you resolved.", "leadership"],
    ["How do you work with stakeholders?", "collaboration"],
    ["Describe a project you shipped under a deadline.", "delivery"],
    ["Walk me through your career so far.", "background"],
  ] as const)("files %j as %s", (question, category) => {
    expect(briefingCategoryOf(question)).toBe(category);
  });
});
