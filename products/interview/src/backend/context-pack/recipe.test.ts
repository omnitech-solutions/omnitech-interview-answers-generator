// The interview context recipe (ADR-0038): the kinds it declares, whose each
// is, the slots every projection reads, and the words of a spoken question
// that select. Checked as configuration, without a model.
import { describe, expect, it } from "vitest";
import {
  ABOUT,
  CODE_ONLY_RECIPE,
  DOMINATES,
  EVIDENCE_PLACES,
  EXTRACTORS,
  FIT_STRENGTHS,
  INTERVIEW_CONTEXT_RECIPE,
  KINDS,
  keyTerms,
  LINKS,
  POSTING_SECTIONS,
  PROJECTIONS,
  RESEARCH_SECTIONS,
  SAID_SECTIONS,
  SPEAKS_FOR,
  sameAs,
  TEXT_SOURCE_KINDS,
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
      // What was said in a stage, read from its transcript: a record of the
      // conversation, and never the candidate's approved record.
      "stage-question": "employer",
      "stage-answer": "employer",
      "employer-signal": "employer",
      "stage-commitment": "employer",
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
  // A record a model extracted is found by its search words and the
  // questions it answers, as a line is by its heading.
  const HEADED = { heading: 3, answers: 3, themes: 2, text: 1 };
  const FOLLOWED = ["names", "tells", "stack", "fit", "proof", "story"];
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
      id: "requirements",
      mode: "ranked",
      kind: KINDS.requirement,
      limit: other,
      maxChars: 400,
      weights: { ...HEADED, technologies: 3 },
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
    // What an earlier stage asked and said to expect.
    {
      id: "asked",
      mode: "ranked",
      kind: KINDS.asked,
      limit: other,
      maxChars: 400,
      weights: HEADED,
    },
    {
      id: "signals",
      mode: "ranked",
      kind: KINDS.signal,
      limit: other,
      maxChars: 400,
      weights: HEADED,
    },
    // What the person answered and promised there (PackFlags.said).
    {
      id: "answered",
      mode: "ranked",
      kind: KINDS.answered,
      limit: other,
      maxChars: 400,
      weights: HEADED,
    },
    {
      id: "commitments",
      mode: "ranked",
      kind: KINDS.commitment,
      limit: other,
      maxChars: 400,
      weights: HEADED,
    },
    {
      id: "evidence",
      mode: "ranked",
      kind: KINDS.achievement,
      // The engine ranks every achievement that bears on a question or is
      // tied to what the slots above selected; the projection's places are
      // filled from that (EVIDENCE_PLACES). It comes AFTER the slots whose
      // ties it follows.
      limit: 400,
      maxChars: 400,
      weights: EVIDENCE,
      share: 0.6,
      follow: FOLLOWED,
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
      id: "employer",
      mode: "ranked",
      kind: KINDS.employerFact,
      limit: other,
      maxChars: 400,
      weights: HEADED,
      share: 0.15,
    },
  ];

  it("are the coach's, an answer's, the one a person inspects, a document's and a briefing's", () => {
    expect(PROJECTIONS).toEqual({
      coach: "coach",
      answer: "answer",
      inspect: "inspect",
      document: "document",
      briefing: "briefing",
    });
    for (const recipe of [INTERVIEW_CONTEXT_RECIPE, CODE_ONLY_RECIPE])
      expect(recipe.projections.map(({ id }) => id)).toEqual([
        "coach",
        "answer",
        "inspect",
        "document",
        "briefing",
      ]);
  });

  const slotIds = (id: string) =>
    INTERVIEW_CONTEXT_RECIPE.projections
      .find((projection) => projection.id === id)
      ?.slots.filter((slot) => slot.mode !== "exact")
      .map((slot) => [slot.id, slot.kind, slot.limit]);

  it("give a document every role and every achievement whole, with what the employer asks for", () => {
    expect(slotIds("document")).toEqual([
      ["requirements", KINDS.requirement, 40],
      ["roles", KINDS.role, 40],
      ["evidence", KINDS.achievement, 400],
    ]);
    const evidence = INTERVIEW_CONTEXT_RECIPE.projections
      .find((projection) => projection.id === "document")
      ?.slots.find((slot) => slot.id === "evidence");
    // Whole: an achievement a note would find too long is still given.
    expect(evidence?.maxChars).toBe(1200);
    expect(evidence?.follow).toEqual(FOLLOWED);
  });

  it("give a briefing one stage: the people, the fit, the notes, and what earlier stages asked, answered and promised", () => {
    expect(slotIds("briefing")).toEqual([
      ["people", KINDS.employerFact, 16],
      ["stories", KINDS.story, 4],
      ["requirements", KINDS.requirement, 16],
      ["prep", KINDS.prep, 16],
      ["asked", KINDS.asked, 16],
      ["signals", KINDS.signal, 8],
      ["answered", KINDS.answered, 8],
      ["commitments", KINDS.commitment, 8],
      ["evidence", KINDS.achievement, 400],
      ["employer", KINDS.employerFact, 16],
    ]);
    const people = INTERVIEW_CONTEXT_RECIPE.projections
      .find((projection) => projection.id === "briefing")
      ?.slots.find((slot) => slot.id === "people");
    expect(people?.where).toEqual([
      { field: "section", op: "equals", value: "stageDetails" },
    ]);
  });

  it("put a slot of evidence after every slot whose ties it follows, in every projection", () => {
    const from = new Set<string>([
      KINDS.prep,
      KINDS.story,
      KINDS.requirement,
      KINDS.asked,
    ]);
    for (const projection of INTERVIEW_CONTEXT_RECIPE.projections) {
      const at = projection.slots.findIndex((slot) => slot.id === "evidence");
      for (const [index, slot] of projection.slots.entries())
        if (from.has(slot.kind)) expect(index, projection.id).toBeLessThan(at);
    }
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
      // Not arranged by role either: a document and a briefing read all.
      document: { places: 400 },
      briefing: { places: 24 },
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
      version: "3",
    });
    expect(INTERVIEW_CONTEXT_RECIPE.aliases).toMatchObject({
      salary: expect.arrayContaining(["compensation", "pay"]),
      postgres: ["postgresql"],
    });
  });
});

describe("what a model is asked to extract", () => {
  const extractor = (id: string) => {
    const found = EXTRACTORS.find((each) => each.id === id);
    if (!found) throw new Error(`No extractor "${id}".`);
    return found;
  };
  const fieldsOf = (id: string) =>
    extractor(id).fields as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, { enum?: string[]; type?: string }>;
    };

  it("is one extractor for each kind of source a model reads, and the recipe declares exactly those", () => {
    expect(INTERVIEW_CONTEXT_RECIPE.extractors).toBe(EXTRACTORS);
    expect(EXTRACTORS.map(({ id, sourceKind }) => [id, sourceKind])).toEqual([
      ["posting", TEXT_SOURCE_KINDS.posting],
      ["employer-said", TEXT_SOURCE_KINDS.employerSaid],
      ["research", TEXT_SOURCE_KINDS.research],
      ["transcript", TEXT_SOURCE_KINDS.transcript],
    ]);
    expect(TEXT_SOURCE_KINDS).toEqual({
      posting: "job-description",
      employerSaid: "employer-said",
      research: "research",
      transcript: "transcript",
    });
  });

  // "Every extracted record carries the exact quote and where it is": no
  // extractor opts out, so the engine keeps nothing whose quote it cannot find.
  it("requires a quote of every record, and asks for search words and the questions it answers", () => {
    for (const each of EXTRACTORS) {
      expect(each.quote, each.id).toBeUndefined();
      expect(each.themes, each.id).toBe(true);
      expect(each.answers, each.id).toBe(true);
      expect(each.instructions.length, each.id).toBeGreaterThan(80);
    }
  });

  it("produces only kinds the recipe declares, and never one of the candidate's", () => {
    for (const each of EXTRACTORS)
      for (const kind of each.recordKinds) {
        expect(INTERVIEW_CONTEXT_RECIPE.kinds[kind], kind).toBeDefined();
        // [SAFETY] A model never writes the person's own record.
        expect(ABOUT[kind as keyof typeof ABOUT], kind).toBe("employer");
      }
  });

  it("reads a posting into requirements, each must or nice, and the employer's own facts, filed by section", () => {
    expect(extractor("posting").recordKinds).toEqual([
      KINDS.requirement,
      KINDS.employerFact,
    ]);
    const fields = fieldsOf("posting");
    expect(fields.additionalProperties).toBe(false);
    expect(fields.required).toEqual(["section"]);
    expect(fields.properties["section"]?.enum).toEqual([...POSTING_SECTIONS]);
    expect(fields.properties["level"]?.enum).toEqual(["must", "nice"]);
    expect(POSTING_SECTIONS).toEqual([
      "mustHaves",
      "niceToHaves",
      "responsibilities",
      "techStack",
      "team",
      "values",
      "process",
      "companyFacts",
    ]);
    for (const section of POSTING_SECTIONS)
      expect(extractor("posting").instructions).toContain(`"${section}"`);
  });

  it("reads what the employer said into process facts, dates and constraints", () => {
    expect(extractor("employer-said").recordKinds).toEqual([
      KINDS.employerFact,
    ]);
    expect(fieldsOf("employer-said").properties["section"]?.enum).toEqual([
      ...SAID_SECTIONS,
    ]);
    expect(SAID_SECTIONS).toEqual(["process", "date", "constraint"]);
  });

  it("reads research into company facts, product, people and risks, and questions worth asking as notes", () => {
    expect(extractor("research").recordKinds).toEqual([
      KINDS.employerFact,
      KINDS.prep,
    ]);
    expect(fieldsOf("research").properties["section"]?.enum).toEqual([
      ...RESEARCH_SECTIONS,
    ]);
    expect(RESEARCH_SECTIONS).toEqual([
      "company",
      "product",
      "people",
      "risk",
      "questionsToAsk",
    ]);
  });

  it("reads a transcript into what was asked, what was answered, what to expect and what was promised", () => {
    expect(extractor("transcript").recordKinds).toEqual([
      KINDS.asked,
      KINDS.answered,
      KINDS.signal,
      KINDS.commitment,
    ]);
    const fields = fieldsOf("transcript");
    expect(fields.additionalProperties).toBe(false);
    // One record kind uses some of them, so none is required.
    expect(fields.required).toEqual([]);
    expect(Object.keys(fields.properties)).toEqual([
      "askedBy",
      "followUps",
      "used",
      "missing",
      "expect",
      "carriesTo",
    ]);
    for (const kind of extractor("transcript").recordKinds)
      expect(extractor("transcript").instructions).toContain(`"${kind}"`);
  });
});

describe("the ties between records", () => {
  const steps = INTERVIEW_CONTEXT_RECIPE.links ?? [];
  const step = (id: string) => {
    const found = steps.find((each) => each.id === id);
    if (!found) throw new Error(`No link step "${id}".`);
    return found;
  };

  it("are three made in code and three a model proposes", () => {
    expect(LINKS).toEqual({
      names: "names",
      tells: "tells",
      stack: "stack",
      fit: "fit",
      proof: "proof",
      story: "story",
    });
    expect(steps.map(({ id }) => id)).toEqual(Object.values(LINKS));
    expect(
      steps.filter((each) => each.instructions).map(({ id }) => id),
    ).toEqual(["fit", "proof", "story"]);
  });

  it("declare each pair: a requirement to evidence, a note to its proof, a question to a story", () => {
    expect(steps.map(({ id, from, to }) => [id, from, to])).toEqual([
      ["names", KINDS.prep, KINDS.achievement],
      ["tells", KINDS.story, KINDS.achievement],
      ["stack", KINDS.requirement, KINDS.achievement],
      ["fit", KINDS.requirement, KINDS.achievement],
      ["proof", KINDS.prep, KINDS.achievement],
      ["story", KINDS.asked, [KINDS.story, KINDS.achievement]],
    ]);
  });

  // [SAFETY] The declaration is the rule the engine enforces: no step ends
  // at a kind of the employer's, so nothing the employer said can be tied in
  // as what the candidate did, whoever proposes it.
  it("never end at anything but the candidate's own record", () => {
    for (const each of steps)
      for (const to of typeof each.to === "string" ? [each.to] : each.to)
        expect(ABOUT[to as keyof typeof ABOUT], each.id).toBe("candidate");
  });

  it("say how strongly evidence fits, with a note on a gap", () => {
    expect(FIT_STRENGTHS).toEqual(["strong", "partial", "gap"]);
    expect(step("fit").fields).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["strength"],
      properties: {
        strength: { enum: ["strong", "partial", "gap"] },
        note: { type: "string" },
      },
    });
    expect(step("story").fields).toMatchObject({
      required: ["rank"],
      properties: { rank: { enum: ["primary", "backup"] } },
    });
    // A model is shown the start of an achievement, never the whole pack.
    for (const id of ["fit", "proof", "story"])
      expect(step(id).maxChars).toBe(220);
  });
});

describe("the recipe with no model in it", () => {
  it("is the same recipe: its id, version, kinds, projections and aliases", () => {
    expect(CODE_ONLY_RECIPE.id).toBe(INTERVIEW_CONTEXT_RECIPE.id);
    expect(CODE_ONLY_RECIPE.version).toBe(INTERVIEW_CONTEXT_RECIPE.version);
    expect(CODE_ONLY_RECIPE.kinds).toBe(INTERVIEW_CONTEXT_RECIPE.kinds);
    expect(CODE_ONLY_RECIPE.projections).toBe(
      INTERVIEW_CONTEXT_RECIPE.projections,
    );
    expect(CODE_ONLY_RECIPE.aliases).toBe(INTERVIEW_CONTEXT_RECIPE.aliases);
  });

  it("has no extractor, and declares every link step while asking a model for none", () => {
    expect(CODE_ONLY_RECIPE.extractors).toBeUndefined();
    expect(CODE_ONLY_RECIPE.extract).toBeUndefined();
    expect((CODE_ONLY_RECIPE.links ?? []).map(({ id }) => id)).toEqual(
      Object.values(LINKS),
    );
    for (const each of CODE_ONLY_RECIPE.links ?? [])
      expect(each.instructions, each.id).toBeUndefined();
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
