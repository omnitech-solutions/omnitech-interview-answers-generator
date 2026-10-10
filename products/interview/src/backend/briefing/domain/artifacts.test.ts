import {
  briefingDraftSchema,
  briefingProposalRequestSchema,
} from "@omnitech/interview-contracts";
import { expect, it } from "vitest";
import type { ProposalRecord, Source } from "../contracts";
import {
  artifactRevisionError,
  proposalCitationError,
  proposalRevisionError,
  questionReplacement,
  refinementError,
  replaceAnswers,
  saveRevisionError,
} from "./artifacts";
import { sha } from "./sources";

const briefing = briefingDraftSchema.parse({
  kind: "non-technical-briefing",
  title: "Recruiter",
  context: {
    company: "Acme",
    role: "Engineer",
    stage: "recruiter",
    profile: { id: "profile", revision: 1 },
  },
  questions: [
    {
      id: "q",
      question: "Tell me about yourself",
      category: "background",
      answerMarkdown: "I mentored engineers.",
      talkingPoints: ["Mentoring", "Products", "Collaboration"],
      evidenceRefs: [],
      gaps: [],
    },
  ],
});
const input = briefingProposalRequestSchema.parse({
  expectedRevision: 2,
  questionId: "q",
  context: briefing.context,
  questions: [
    { id: "q", question: "Tell me about yourself", category: "background" },
  ],
});
it("requires one existing card and unchanged context for a refinement", () => {
  expect(refinementError(briefing, input)).toBeNull();
  expect(refinementError(briefing, { ...input, questionId: "absent" })).toBe(
    "invalid-refinement",
  );
  expect(
    refinementError(briefing, {
      ...input,
      questions: [...input.questions, ...input.questions],
    }),
  ).toBe("invalid-refinement");
  expect(
    refinementError(briefing, {
      ...input,
      context: { ...input.context, company: "Elsewhere" },
    }),
  ).toBe("invalid-refinement");
  expect(
    refinementError(briefing, { ...input, questionId: undefined }),
  ).toBeNull();
});
it("allows replacement in a full pack, rejects missing cards before capacity", () => {
  const full = {
    ...briefing,
    questions: Array.from({ length: 20 }, (_, index) => ({
      ...briefing.questions[0]!,
      id: `q${index}`,
    })),
  };
  expect(questionReplacement(full, undefined)).toEqual({
    error: "pack-full",
    hint: "A pack holds 20 answers. Remove one to ask another.",
  });
  expect(questionReplacement(full, "absent")).toEqual({ error: "not-found" });
  expect(questionReplacement(full, "q0")).toEqual({
    replacing: full.questions[0],
  });
  expect(questionReplacement(briefing, undefined)).toEqual({
    replacing: undefined,
  });
});
it("redrafts in place or appends, preserving unrelated cards", () => {
  const existing = briefing.questions[0]!;
  const other = { ...existing, id: "other" };
  const answer = { ...existing, answerMarkdown: "Replacement" };
  expect(replaceAnswers([existing, other], [answer], existing)).toEqual([
    answer,
    other,
  ]);
  expect(replaceAnswers([existing], [other], undefined)).toEqual([
    existing,
    other,
  ]);
  expect(replaceAnswers([existing], [], existing)).toEqual([existing]);
});
it("pins proposal identity and the profile identity observed before saving", () => {
  const proposal: ProposalRecord = {
    id: "p",
    artifactId: "artifact",
    baseRevision: 2,
    profileId: "profile",
    profileRevision: 1,
    profileSha256: "hash",
    briefing,
    sourceSnapshot: [],
  };
  expect(proposalRevisionError(proposal, "artifact", 2)).toBeNull();
  expect(proposalRevisionError(proposal, "other", 2)).toBe("revision-conflict");
  expect(proposalRevisionError(proposal, "artifact", 3)).toBe(
    "revision-conflict",
  );
  expect(artifactRevisionError(2, 2)).toBeNull();
  expect(artifactRevisionError(3, 2)).toBe("revision-conflict");
  expect(saveRevisionError(briefing, 2, 2, briefing)).toBeNull();
  expect(saveRevisionError(undefined, 2, 2, briefing)).toBe(
    "revision-conflict",
  );
  expect(
    saveRevisionError(
      {
        ...briefing,
        context: { ...briefing.context, profile: { id: "other", revision: 1 } },
      },
      2,
      2,
      briefing,
    ),
  ).toBe("revision-conflict");
  expect(
    saveRevisionError(
      {
        ...briefing,
        context: {
          ...briefing.context,
          profile: { id: "profile", revision: 2 },
        },
      },
      2,
      2,
      briefing,
    ),
  ).toBe("revision-conflict");
});
it("requires the citation snapshot's complete identity, quotation and content hash", () => {
  const source: Source = {
    id: "source",
    revision: 1,
    pointer: "/roles/0/proof_points/0",
    sourceKind: "candidate",
    text: "Mentored engineers",
    sha256: sha("Mentored engineers"),
  };
  const ref = {
    ...source,
    quote: source.text,
    text: "mentored engineers",
    field: "answerMarkdown" as const,
  };
  const cited = {
    ...briefing,
    questions: [{ ...briefing.questions[0]!, evidenceRefs: [ref] }],
  };
  expect(proposalCitationError(cited, [source])).toBeNull();
  for (const altered of [
    { ...source, revision: 2 },
    { ...source, pointer: "/roles/1/proof_points/0" },
    { ...source, sourceKind: "employer-context" as const },
    { ...source, text: "Different" },
    { ...source, text: `${source.text}!` },
  ]) {
    expect(proposalCitationError(cited, [altered])).toBe(
      "citation-quote-conflict",
    );
  }
  expect(proposalCitationError(cited, [])).toBe("citation-quote-conflict");
});
