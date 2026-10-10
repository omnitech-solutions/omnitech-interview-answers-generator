import { expect, it } from "vitest";
import { modelSchema, preparedModelSchema, type Source } from "../contracts";
import {
  groundAnswers,
  supportedFigures,
  validatePrepared,
  validateQuestion,
  verifiedCitation,
} from "./grounding";
import { sha } from "./sources";

const source: Source = {
  pointer: "/roles/0/proof_points/0",
  text: "Mentored engineers",
  sourceKind: "candidate",
  id: "source",
  revision: 1,
  sha256: sha("Mentored engineers"),
};
const citation = {
  text: "mentored engineers",
  sourceKind: "candidate" as const,
  pointer: source.pointer,
  quote: source.text,
};
const declared = {
  id: "q",
  question: "Tell me about yourself",
  category: "background" as const,
};
const answer = modelSchema.parse({
  questions: [
    {
      id: "q",
      answerMarkdown: "I mentored engineers.",
      talkingPoints: ["Mentoring", "Products", "Collaboration"],
      citations: [{ ...citation, field: "answerMarkdown" }],
      gaps: [],
    },
  ],
}).questions[0]!;
it("matches exact quotations and the declared source kind and answer text", () => {
  expect(
    verifiedCitation(citation, answer.answerMarkdown, [source])?.sha256,
  ).toBe(source.sha256);
  expect(
    verifiedCitation(
      { ...citation, quote: "Invented" },
      answer.answerMarkdown,
      [source],
    ),
  ).toBeNull();
  expect(
    verifiedCitation(
      { ...citation, sourceKind: "employer-context" },
      answer.answerMarkdown,
      [source],
    ),
  ).toBeNull();
  expect(verifiedCitation(citation, "Other text", [source])).toBeNull();
});
it("keeps unsupported claims as deduplicated gaps without discarding the answer", () => {
  const invalid = {
    ...answer,
    citations: [
      { ...answer.citations[0]!, quote: "Invented" },
      { ...answer.citations[0]!, quote: "Invented" },
    ],
  };
  const result = validateQuestion(invalid, declared, [source]);
  expect(result.answerMarkdown).toBe(answer.answerMarkdown);
  expect(result.evidenceRefs).toEqual([]);
  expect(result.gaps).toEqual([
    "Could not verify “mentored engineers” against your sources.",
  ]);
  expect(
    validateQuestion({ ...answer, citations: [] }, declared, [source]).gaps,
  ).toEqual(["No source was cited for this answer."]);
});
it("supports metrics only for a cited role, and only in the cited answer field", () => {
  const metric = {
    ...source,
    pointer: "/roles/0/metrics/0/value",
    text: "4M+",
  };
  const other = { ...metric, pointer: "/roles/1/metrics/0/value", text: "9M" };
  expect([
    ...supportedFigures(
      [{ pointer: source.pointer, quote: source.text }],
      [source, metric, other],
    ),
  ]).toEqual(["4M+"]);
  const result = validateQuestion(
    {
      ...answer,
      answerMarkdown: "I mentored engineers supporting 4M+ users.",
      talkingPoints: ["4M+ users", "9M users", "Mentoring"],
    },
    declared,
    [source, metric, other],
  );
  expect(result.gaps).toEqual([
    "States a figure your sources don’t support: 4M+. Check it before using.",
    "States a figure your sources don’t support: 9M. Check it before using.",
  ]);
});
it("requires qualified metrics and ranges to keep their exact wording", () => {
  const metric = {
    ...source,
    pointer: "/roles/0/metrics/0/value",
    text: "4M+",
  };
  const result = validateQuestion(
    {
      ...answer,
      answerMarkdown: "I reached 4M users.",
      citations: [
        {
          ...citation,
          field: "answerMarkdown",
          pointer: metric.pointer,
          text: "4M",
          quote: "4M",
        },
      ],
    },
    declared,
    [metric],
  );
  expect(result.gaps).toContain(
    "Use the figure exactly as your sources state it: “4M+”.",
  );
  const range = { ...source, text: "Latency was 10–20 ms" };
  const ranged = validateQuestion(
    {
      ...answer,
      answerMarkdown: "Latency was 10 ms.",
      citations: [
        {
          ...citation,
          field: "answerMarkdown",
          text: "10",
          quote: "10",
          pointer: range.pointer,
        },
      ],
    },
    declared,
    [range],
  );
  expect(ranged.gaps).toContain(
    "Use the figure exactly as your sources state it: “10–20”.",
  );
});
it("flags answers longer than 180 words", () => {
  expect(
    validateQuestion(
      { ...answer, answerMarkdown: "word ".repeat(181) },
      declared,
      [source],
    ).gaps,
  ).toContain("This runs past 60 seconds spoken; trim it.");
});
it("excludes planned agenda minutes from numeric claims and removes unknown story roles", () => {
  const prepared = preparedModelSchema.parse({
    call: { summary: "Call", detail: "Details" },
    agenda: [{ topic: "Introductions", minutes: 30 }],
    positioning: { note: "Lead with mentoring", steps: [] },
    fit: { strong: [], watch: [] },
    teams: [],
    pipeline: { stages: [], later: [] },
    stories: [
      {
        title: "Mentoring",
        shape: "I mentored engineers.",
        covers: [],
        roleId: "/roles/9",
      },
    ],
    ask: [],
    watchOuts: [],
    citations: [citation],
    gaps: [],
  });
  const result = validatePrepared(prepared, [source], 1);
  expect(result.gaps).toEqual([]);
  expect(result.stories[0]).not.toHaveProperty("roleId");
  expect(result.evidenceRefs).toHaveLength(1);
});

it("requires a complete answer set and matches ids before falling back to order", () => {
  const second = { ...declared, id: "other", question: "Another question" };
  expect(groundAnswers({ questions: [] }, [declared], [source])).toEqual({
    error: {
      code: "generation-failed",
      hint: "The model answered 0 of 1 questions.",
    },
  });
  const reordered = groundAnswers(
    {
      questions: [
        { ...answer, id: "other", answerMarkdown: "Second answer" },
        answer,
      ],
    },
    [declared, second],
    [source],
  );
  expect(
    reordered.questions?.map(({ id, answerMarkdown }) => ({
      id,
      answerMarkdown,
    })),
  ).toEqual([
    { id: "q", answerMarkdown: answer.answerMarkdown },
    { id: "other", answerMarkdown: "Second answer" },
  ]);
  const fallback = groundAnswers(
    { questions: [{ ...answer, id: "unknown" }] },
    [declared],
    [source],
  );
  expect(fallback.questions?.[0]?.id).toBe("q");
});
