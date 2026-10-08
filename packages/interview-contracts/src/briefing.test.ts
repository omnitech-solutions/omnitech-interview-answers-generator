import { expect, it } from "vitest";
import {
  briefingCondenseSchema,
  briefingContextSchema,
  briefingDraftSchema,
  candidateMatrixSchema,
} from "./briefing";

it("accepts a synthetic matrix with known nested role fields and preserves extensions", () => {
  const matrix = candidateMatrixSchema.parse({
    candidate: { name: "Example Candidate", preferredLocation: "Remote" },
    roles: [
      {
        title: "Engineer",
        company: "Acme",
        technologies: ["TypeScript"],
        customProof: "mentored a team",
      },
    ],
    industry_mappings: [{ industry: "software", best_fit_roles: ["Engineer"] }],
    experience_matrix_extensions: { sourceVersion: "one" },
  });
  expect(matrix.roles[0]?.["customProof"]).toBe("mentored a team");
  expect(matrix.experience_matrix_extensions).toEqual({ sourceVersion: "one" });
  expect(
    candidateMatrixSchema.safeParse({
      candidate: {},
      roles: [
        { title: "Engineer", company: "Acme", technologies: "TypeScript" },
      ],
    }).success,
  ).toBe(false);
});

it("requires exactly three talking points and bounded pack size", () => {
  const base = {
    kind: "non-technical-briefing" as const,
    title: "Recruiter preparation",
    context: {
      company: "Acme",
      role: "Engineer",
      stage: "recruiter" as const,
      profile: { id: "p", revision: 1 },
    },
    questions: [
      {
        id: "q",
        question: "Tell me about yourself",
        category: "background" as const,
        answerMarkdown: "I build systems.",
        talkingPoints: ["one", "two"],
        evidenceRefs: [],
        gaps: [],
      },
    ],
  };
  expect(briefingDraftSchema.safeParse(base).success).toBe(false);
  expect(
    briefingDraftSchema.safeParse({
      ...base,
      questions: [
        { ...base.questions[0], talkingPoints: ["one", "two", "three"] },
      ],
    }).success,
  ).toBe(true);
  expect(
    briefingDraftSchema.safeParse({
      ...base,
      questions: Array(21).fill({
        ...base.questions[0],
        talkingPoints: ["one", "two", "three"],
      }),
    }).success,
  ).toBe(false);
});

it("keeps a condensed copy of the two long setup fields beside the originals", () => {
  const context = {
    company: "Acme",
    role: "Engineer",
    stage: "recruiter" as const,
    profile: { id: "p", revision: 1 },
    jobDescription: "The whole posting",
    research: "The whole research",
  };
  // The copy is optional, and so is each of its fields.
  expect(briefingContextSchema.parse(context).condensed).toBeUndefined();
  expect(
    briefingContextSchema.parse({ ...context, condensed: {} }).condensed,
  ).toEqual({});
  expect(
    briefingContextSchema.parse({
      ...context,
      condensed: { jobDescription: "Posting, short", research: "Notes" },
    }),
  ).toMatchObject({
    jobDescription: "The whole posting",
    research: "The whole research",
    condensed: { jobDescription: "Posting, short", research: "Notes" },
  });
  // Only the two long fields can be condensed, within the field's own bound.
  expect(
    briefingContextSchema.safeParse({
      ...context,
      condensed: { employerNotes: "Notes" },
    }).success,
  ).toBe(false);
  expect(
    briefingContextSchema.safeParse({
      ...context,
      condensed: { research: "x".repeat(32_001) },
    }).success,
  ).toBe(false);
});

it("asks to condense a pack by the revision it was read at, and nothing else", () => {
  expect(briefingCondenseSchema.parse({ expectedRevision: 3 })).toEqual({
    expectedRevision: 3,
  });
  for (const input of [
    {},
    { expectedRevision: -1 },
    { expectedRevision: 1.5 },
    { expectedRevision: 3, jobDescription: "Condense this instead" },
  ])
    expect(briefingCondenseSchema.safeParse(input).success).toBe(false);
});
