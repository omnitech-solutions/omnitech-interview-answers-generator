import { describe, expect, it } from "vitest";
import {
  interviewClaimSchema,
  interviewClaimsSchema,
  interviewMetricSchema,
  interviewProvenanceSchema,
} from "./assistant";

const sha = "a".repeat(64);
const claim = {
  kind: "technical",
  field: "answerMarkdown",
  text: "Compare the expected revision.",
  citations: [{ id: "ref", revision: 1, sha256: sha, quote: "compares" }],
};

describe("interview claims", () => {
  it("accepts a cited claim and a bounded list of them", () => {
    expect(interviewClaimSchema.parse(claim)).toEqual(claim);
    expect(interviewClaimsSchema.parse([claim, claim])).toHaveLength(2);
  });

  it("refuses a claim with no citation, a bad hash, or an unknown field", () => {
    expect(
      interviewClaimSchema.safeParse({ ...claim, citations: [] }).success,
    ).toBe(false);
    expect(
      interviewClaimSchema.safeParse({
        ...claim,
        citations: [{ ...claim.citations[0], sha256: "not-a-hash" }],
      }).success,
    ).toBe(false);
    expect(
      interviewClaimSchema.safeParse({ ...claim, field: "title" }).success,
    ).toBe(false);
    expect(
      interviewClaimSchema.safeParse({ ...claim, extra: true }).success,
    ).toBe(false);
  });

  it("requires a finite metric value and a unit", () => {
    expect(interviewMetricSchema.parse({ value: 40, unit: "%" })).toEqual({
      value: 40,
      unit: "%",
    });
    expect(
      interviewMetricSchema.safeParse({ value: Number.NaN, unit: "%" }).success,
    ).toBe(false);
    expect(
      interviewMetricSchema.safeParse({ value: 1, unit: " " }).success,
    ).toBe(false);
  });

  it("records provenance with the sources a draft was built from", () => {
    const provenance = {
      proposalId: "p",
      draftRevision: 1,
      acceptedDraftRevision: 2,
      promptVersion: "interview-grounding-3",
      adapterVersion: "interview-1",
      claims: [claim],
      sources: [
        {
          id: "ref",
          revision: 1,
          sha256: sha,
          sourceKind: "technical-reference",
          classification: "public",
          audience: ["alice"],
          locator: "local://ref",
        },
      ],
    };
    expect(interviewProvenanceSchema.parse(provenance)).toEqual(provenance);
    expect(
      interviewProvenanceSchema.safeParse({ ...provenance, sources: [{}] })
        .success,
    ).toBe(false);
  });
});
