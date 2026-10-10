// The interview context recipe (ADR-0038): the kinds it declares, whose each
// is, the slots every projection reads, and the words of a spoken question
// that select. Checked as configuration, without a model.
import { describe, expect, it } from "vitest";
import {
  ABOUT,
  DOMINATES,
  EVIDENCE_PLACES,
  INTERVIEW_CONTEXT_RECIPE,
  KINDS,
  keyTerms,
  PROJECTIONS,
  SPEAKS_FOR,
  sameAs,
  wordsOf,
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
      "go c# node.js c++",
    );
    expect(keyTerms("R, Vue.js and .NET")).toBe("r vue.js net");
  });

  // ADR-0038 scenario 3: "The two-letter term is matched, not dropped."
  it("keeps every technology of a question that names several", () => {
    expect(
      keyTerms(
        "Which of these have you used in production: NestJS, Go, PostgreSQL?",
      ),
    ).toBe("production nestjs go postgresql");
  });

  // How a question is put is not what it is about: left in, "experience"
  // finds every "employee experience" tag and "background" every
  // "background job".
  it("drops how the question is put", () => {
    expect(keyTerms("What is your experience with NestJS?")).toBe("nestjs");
    expect(keyTerms("Any Rust or Haskell in your background?")).toBe(
      "rust haskell",
    );
    expect(keyTerms("How do you approach third-party carrier APIs?")).toBe(
      "third party carrier apis",
    );
    expect(
      keyTerms("Have you ever worked with Kafka, and how did you handle it?"),
    ).toBe("kafka");
    expect(keyTerms("Do you know Elixir?")).toBe("elixir");
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
      "candidate-achievement": "candidate",
      "candidate-story": "candidate",
      "candidate-preference": "preference",
      "employer-detail": "employer",
      "employer-requirement": "employer",
      "employer-fact": "employer",
      "prep-note": "employer",
      // A raw turn of a transcript: never the candidate's approved record.
      "transcript-turn": "employer",
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
  // Where a word was found says how much it means (recipe.ts).
  const EVIDENCE = {
    technologies: 3,
    company: 3,
    themes: 2,
    stack: 2,
    tags: 1,
    text: 1,
    period: 0,
  };
  const ROLE = { technologies: 3, company: 3, tags: 2, text: 1 };
  const HEADED = { heading: 3, text: 1 };
  const slotsOf = (other: number) => [
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
      kind: KINDS.achievement,
      // The engine ranks all that bears on a question; the projection's
      // places are filled from that (EVIDENCE_PLACES).
      limit: 60,
      maxChars: 400,
      weights: EVIDENCE,
      share: 0.6,
    },
    {
      id: "roles",
      mode: "ranked",
      kind: KINDS.role,
      limit: 3,
      maxChars: 400,
      weights: ROLE,
    },
    {
      id: "preferences",
      mode: "ranked",
      kind: KINDS.preference,
      limit: other,
      maxChars: 400,
      weights: HEADED,
    },
    {
      id: "requirements",
      mode: "ranked",
      kind: KINDS.requirement,
      limit: other,
      maxChars: 400,
      weights: { ...HEADED, technologies: 3 },
      share: 0.15,
    },
    {
      id: "employer",
      mode: "ranked",
      kind: KINDS.employerFact,
      limit: other,
      maxChars: 400,
      weights: HEADED,
      share: 0.15,
    },
    {
      id: "prep",
      mode: "ranked",
      kind: KINDS.prep,
      limit: other,
      maxChars: 400,
      weights: HEADED,
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
    ["coach", 3],
    ["answer", 6],
    ["inspect", 24],
  ] as const)(
    "%s reads the same slots, with %i of each kind but the person's own",
    (id, other) => {
      expect(
        INTERVIEW_CONTEXT_RECIPE.projections.find(
          (projection) => projection.id === id,
        ),
      ).toEqual({ id, slots: slotsOf(other) });
    },
  );

  it("give the coach four places for evidence and an answer six, over two roles; the inspecting view is not arranged by role", () => {
    expect(EVIDENCE_PLACES).toEqual({
      coach: { places: 4, roles: 2, lead: 3 },
      answer: { places: 6, roles: 2, lead: 4 },
      inspect: { places: 60 },
    });
    // The primary role leads, and never takes every place of two.
    for (const plan of Object.values(EVIDENCE_PLACES))
      if (plan.roles) expect(plan.lead).toBeLessThan(plan.places);
    expect(DOMINATES).toBe(2);
    expect(SPEAKS_FOR).toBe(2);
  });

  // [DOMAIN] A transcript's turn is raw material for extraction: declared, so
  // it is prepared, counted and inspectable, and in no slot of any projection,
  // so it is never offered to a reader as a fact.
  it("read only kinds the recipe declares, and every kind but a raw transcript turn is read by some slot", () => {
    const read = new Set(
      INTERVIEW_CONTEXT_RECIPE.projections.flatMap((projection) =>
        projection.slots.map((slot) => slot.kind),
      ),
    );
    expect(read.has(KINDS.turn)).toBe(false);
    expect(INTERVIEW_CONTEXT_RECIPE.kinds[KINDS.turn]).toEqual({});
    expect([...read, KINDS.turn].sort()).toEqual(
      Object.values(KINDS).slice().sort(),
    );
  });

  it("is versioned configuration", () => {
    expect(INTERVIEW_CONTEXT_RECIPE).toMatchObject({
      id: "interview-context",
      version: "2",
    });
    expect(INTERVIEW_CONTEXT_RECIPE.aliases).toMatchObject({
      salary: expect.arrayContaining(["compensation", "pay"]),
      postgres: ["postgresql"],
    });
  });
});

describe("the words that mean the same", () => {
  const aliases = INTERVIEW_CONTEXT_RECIPE.aliases ?? {};

  it("work every way round", () => {
    for (const [word, others] of Object.entries(aliases))
      for (const other of others)
        expect(aliases[other], `${other} for ${word}`).toContain(word);
  });

  it("let a migration find a modernization, and a conflict a disagreement", () => {
    expect(aliases["migration"]).toEqual(
      expect.arrayContaining(["modernization", "migrated", "replatform"]),
    );
    expect(aliases["modernization"]).toContain("migration");
    expect(aliases["conflict"]).toEqual(
      expect.arrayContaining(["disagreement", "dispute"]),
    );
    expect(aliases["mentor"]).toEqual(
      expect.arrayContaining(["mentoring", "coaching", "mentorship"]),
    );
  });

  // "rate" and "base" are also an error rate and a code base; "legacy" is
  // what is moved from, not the move; "pushback" is also a design review.
  it("join no word that means two things", () => {
    for (const word of ["rate", "base", "legacy", "pushback", "tension"])
      expect(aliases[word], word).toBeUndefined();
  });

  it("hold a word in its forms, so an incident finds incidents", () => {
    expect(aliases["incident"]).toEqual(["incidents"]);
    expect(aliases["apis"]).toEqual(["api"]);
    expect(aliases["idempotent"]).toEqual(["idempotency"]);
    expect(sameAs("teams")).toEqual(["teams", "team"]);
    expect(sameAs("ledger")).toEqual(["ledger"]);
  });

  // The engine splits "event-driven" in two, and "driven" alone would find
  // every "schema-driven" form: a compound is one term, said whole.
  it("keep a compound as one term", () => {
    for (const compound of ["event driven", "schema driven", "third party"])
      expect(aliases[compound], compound).toEqual([]);
  });

  it("split a text into the words the engine matches on", () => {
    expect(wordsOf("Node.js, C# and safe-modernization.")).toEqual([
      "node.js",
      "c#",
      "and",
      "safe",
      "modernization",
    ]);
  });
});
