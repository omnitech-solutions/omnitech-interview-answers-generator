// The interview context recipe (ADR-0038): the kinds it declares, whose each
// is, the slots every projection reads, and the words of a spoken question
// that select. Checked as configuration, without a model.
import { describe, expect, it } from "vitest";
import {
  ABOUT,
  INTERVIEW_CONTEXT_RECIPE,
  KINDS,
  keyTerms,
  PROJECTIONS,
} from "./recipe";

describe("the words of a question that select", () => {
  it("drops what every question shares and keeps what this one is about", () => {
    expect(
      keyTerms("Tell me about a time you led a PostgreSQL migration."),
    ).toBe("led postgresql migration");
    expect(keyTerms("Um, okay, so, could you walk me through it?")).toBe("");
  });

  // ADR-0038, the second of the five differences: "A query of 'Go' is dropped
  // by the server as too short." It is a word, and it stays.
  it("keeps a short technology name", () => {
    expect(keyTerms("Go")).toBe("go");
    expect(keyTerms("Have you used Go, C#, Node.js or C++?")).toBe(
      "used go c# node.js c++",
    );
    expect(keyTerms("R, Vue.js and .NET")).toBe("r vue.js net");
  });

  // ADR-0038 scenario 3: "The two-letter term is matched, not dropped."
  it("keeps every technology of a question that names several", () => {
    expect(
      keyTerms(
        "Which of these have you used in production: NestJS, Go, PostgreSQL?",
      ),
    ).toBe("used production nestjs go postgresql");
  });

  it("reads a question the same whatever its case, and ends no word on a full stop", () => {
    expect(keyTerms("KUBERNETES at scale.")).toBe("kubernetes scale");
    expect(keyTerms("node.js.")).toBe("node.js");
    expect(keyTerms("…")).toBe("");
    expect(keyTerms("")).toBe("");
  });

  it("keeps a figure", () => {
    expect(keyTerms("What about the 99.95% uptime?")).toBe("99.95 uptime");
  });
});

describe("the kinds of fact", () => {
  it("are each declared by the recipe, and the recipe declares no other", () => {
    expect(Object.keys(INTERVIEW_CONTEXT_RECIPE.kinds).sort()).toEqual(
      Object.values(KINDS).slice().sort(),
    );
  });

  it("each say whose they are", () => {
    expect(Object.keys(ABOUT).sort()).toEqual(
      Object.values(KINDS).slice().sort(),
    );
    expect(ABOUT).toEqual({
      "candidate-profile": "candidate",
      "candidate-role": "candidate",
      "candidate-evidence": "candidate",
      "candidate-story": "candidate",
      "candidate-preference": "preference",
      "employer-detail": "employer",
      "employer-requirement": "employer",
      "employer-fact": "employer",
      "prep-note": "employer",
    });
  });

  // "An employer's requirement is never turned into a claim about the
  // candidate" (ADR-0038).
  it("never give anything of the employer's to the candidate", () => {
    for (const [kind, about] of Object.entries(ABOUT))
      expect(about === "candidate", kind).toBe(
        kind.startsWith("candidate-") && kind !== KINDS.preference,
      );
  });
});

describe("the projections", () => {
  const EXACT = [
    { id: "candidate.name", mode: "exact", kind: KINDS.profile, field: "name" },
    {
      id: "candidate.headline",
      mode: "exact",
      kind: KINDS.profile,
      field: "headline",
    },
    {
      id: "candidate.location",
      mode: "exact",
      kind: KINDS.profile,
      field: "location",
    },
    {
      id: "employer.company",
      mode: "exact",
      kind: KINDS.employer,
      field: "company",
    },
    { id: "employer.role", mode: "exact", kind: KINDS.employer, field: "role" },
  ];
  const WEIGHTS = { technologies: 3, company: 3, tags: 2, text: 1 };
  const slotsOf = (evidence: number, other: number) => [
    ...EXACT,
    {
      id: "stories",
      mode: "ranked",
      kind: KINDS.story,
      limit: 2,
      maxChars: 400,
    },
    {
      id: "evidence",
      mode: "ranked",
      kind: KINDS.evidence,
      limit: evidence,
      maxChars: 400,
      weights: WEIGHTS,
      share: 0.6,
    },
    {
      id: "roles",
      mode: "ranked",
      kind: KINDS.role,
      limit: 3,
      maxChars: 400,
      weights: WEIGHTS,
    },
    {
      id: "preferences",
      mode: "ranked",
      kind: KINDS.preference,
      limit: other,
      maxChars: 400,
    },
    {
      id: "requirements",
      mode: "ranked",
      kind: KINDS.requirement,
      limit: other,
      maxChars: 400,
      share: 0.15,
    },
    {
      id: "employer",
      mode: "ranked",
      kind: KINDS.employerFact,
      limit: other,
      maxChars: 400,
      share: 0.15,
    },
    {
      id: "prep",
      mode: "ranked",
      kind: KINDS.prep,
      limit: other,
      maxChars: 400,
    },
  ];

  it("are the coach's, an answer's and the one a person inspects", () => {
    expect(PROJECTIONS).toEqual({
      coach: "coach",
      answer: "answer",
      inspect: "inspect",
    });
    expect(INTERVIEW_CONTEXT_RECIPE.projections.map(({ id }) => id)).toEqual([
      "coach",
      "answer",
      "inspect",
    ]);
  });

  it.each([
    ["coach", 6, 3],
    ["answer", 16, 6],
    ["inspect", 60, 24],
  ] as const)(
    "%s reads the same slots, %i of evidence and %i of each other kind",
    (id, evidence, other) => {
      expect(
        INTERVIEW_CONTEXT_RECIPE.projections.find(
          (projection) => projection.id === id,
        ),
      ).toEqual({ id, slots: slotsOf(evidence, other) });
    },
  );

  it("read only kinds the recipe declares, and every kind is read by some slot", () => {
    const read = new Set(
      INTERVIEW_CONTEXT_RECIPE.projections.flatMap((projection) =>
        projection.slots.map((slot) => slot.kind),
      ),
    );
    expect([...read].sort()).toEqual(Object.values(KINDS).slice().sort());
  });

  it("is versioned configuration", () => {
    expect(INTERVIEW_CONTEXT_RECIPE).toMatchObject({
      id: "interview-context",
      version: "1",
    });
    expect(INTERVIEW_CONTEXT_RECIPE.aliases).toMatchObject({
      salary: expect.arrayContaining(["compensation", "pay"]),
      postgres: ["postgresql"],
    });
  });
});
