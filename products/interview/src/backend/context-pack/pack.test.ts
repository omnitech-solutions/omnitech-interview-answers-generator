// The context pack (ADR-0038) on a real AI engine with no model behind it: a
// session's approved material prepared into records, then resolved for one
// question. Structured sources call no model, so the engine here has no
// profile and no provider; a call to one would fail the suite. Every name
// and figure is invented.
import { createAiEngine } from "@omnitech/ai-engine";
import type { CandidateMatrix } from "@omnitech/interview-contracts";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BRIEF,
  contextOf,
  EXECUTION,
  HARBOURLINE,
  MATRIX,
  NEWER,
  PROFILE,
  QUAYSIDE,
} from "./fixture";
import {
  type ContextPack,
  ContextPackError,
  prepareContextPack,
  sessionSources,
} from "./pack";
import { KINDS, PROJECTIONS, type ProjectionId } from "./recipe";

const engine = createAiEngine({ profiles: [], providers: {} });
const packOf = (context = contextOf()) =>
  prepareContextPack(engine, sessionSources(context), EXECUTION);

const GO = "Have you used Go?";
const QUESTIONS = [
  "",
  GO,
  "Which of these have you used in production: NestJS, Go, PostgreSQL?",
  "Do you know Elixir?",
  "What are your salary expectations?",
  "Do you have any questions for us?",
  "Tell me about a conflict with a stakeholder",
  "Tell me about yourself",
];

let pack: ContextPack;
beforeAll(async () => {
  pack = await packOf();
});

const inSlot = <Fact extends { slot: string }>(
  facts: readonly Fact[],
  slot: string,
) => facts.filter((fact) => fact.slot === slot);
const texts = (facts: readonly { text: string }[]) =>
  facts.map((fact) => fact.text);

describe("a known field", () => {
  it("is looked up by its slot", () => {
    expect(pack.lookup("employer.company")).toBe("Larkspur Analytics");
    expect(pack.lookup("employer.role")).toBe("Principal Engineer");
    expect(pack.lookup("candidate.name")).toBe("Mira Okonjo");
    expect(pack.lookup("candidate.headline")).toBe("Platform engineer");
    expect(pack.lookup("candidate.location")).toBe("Lisbon");
  });

  it("is undefined when the material does not give it, or no slot has that name", async () => {
    const unnamed = await packOf(
      contextOf({ brief: null }, {
        ...MATRIX,
        candidate: { name: "Mira Okonjo" },
      } as CandidateMatrix),
    );
    expect(unnamed.lookup("candidate.name")).toBe("Mira Okonjo");
    expect(unnamed.lookup("candidate.location")).toBeUndefined();
    expect(unnamed.lookup("employer.company")).toBeUndefined();
    expect(pack.lookup("candidate.shoe-size")).toBeUndefined();
    // A ranked slot is not a field.
    expect(pack.lookup("evidence")).toBeUndefined();
  });

  // ADR-0038 scenario 3: "Company, role, stage: covered, exact. Looked up;
  // never ranked."
  it("is given whatever was asked, never ranked against the question", () => {
    for (const question of QUESTIONS) {
      const exact = pack.facts("coach", question).filter((fact) => fact.exact);
      expect(
        exact.map((fact) => [fact.slot, fact.text, fact.about]),
        question,
      ).toEqual([
        ["candidate.name", "Mira Okonjo", "candidate"],
        ["candidate.headline", "Platform engineer", "candidate"],
        ["candidate.location", "Lisbon", "candidate"],
        ["employer.company", "Larkspur Analytics", "employer"],
        ["employer.role", "Principal Engineer", "employer"],
      ]);
    }
  });
});

describe("a question that names a technology", () => {
  // ADR-0038 scenario 3: "Go: the two-letter term is matched, not dropped."
  it("selects the evidence and the role of the role that used it, and no other role's", () => {
    const facts = pack.facts("inspect", GO);
    const evidence = inSlot(facts, "evidence");
    expect(evidence.length).toBe(6);
    for (const fact of evidence) {
      expect(fact.id, fact.text).toMatch(/^role:harbourline:staff-engineer:/);
      expect(fact.pointer, fact.text).toMatch(/^\/roles\/0\//);
      expect(fact).toMatchObject({
        kind: KINDS.evidence,
        about: "candidate",
        exact: false,
      });
    }
    expect(texts(evidence)).toContain(
      "Rewrote the berth scheduler in Go for the harbour pilots",
    );
    expect(inSlot(facts, "roles")).toEqual([
      {
        id: "role:harbourline:staff-engineer",
        pointer: "/roles/0",
        text: "Staff Engineer, Harbourline (2022 to 2025)",
        kind: KINDS.role,
        about: "candidate",
        slot: "roles",
        exact: false,
      },
    ]);
  });

  it("leaves the other roles' evidence out, and says it was for relevance", () => {
    const view = pack.view("inspect", GO);
    const left = view.excluded.filter((fact) => fact.slot === "evidence");
    expect(texts(left).sort()).toEqual(
      [
        "Built a NestJS reporting service for dock invoices",
        "Reviewed every change to the invoice ledger",
        "invoices per day: 42000",
        "Shipped a Rails booking flow for ferry crews",
      ].sort(),
    );
    for (const fact of left)
      expect(fact).toMatchObject({ reason: "relevance", about: "candidate" });
    expect(
      view.excluded
        .filter((fact) => fact.slot === "roles")
        .map((fact) => [fact.id, fact.reason]),
    ).toEqual([
      ["role:quayside-freight:senior-engineer", "relevance"],
      ["role:tidewater-labs:engineer", "relevance"],
    ]);
  });

  // ADR-0038, the first difference: a query naming several technologies
  // picked one role on the server and another in the view.
  it("gives the reader and the view the same selection", () => {
    for (const projection of Object.values(PROJECTIONS))
      for (const question of QUESTIONS)
        expect(
          pack.view(projection, question).selected,
          `${projection}: ${question}`,
        ).toEqual(pack.facts(projection, question));
  });

  it("selects every role a several-technology question names, each with its evidence", () => {
    const facts = pack.facts(
      "inspect",
      "Which of these have you used in production: NestJS, Go, PostgreSQL?",
    );
    expect(inSlot(facts, "roles").map((fact) => fact.id)).toEqual([
      "role:harbourline:staff-engineer",
      "role:quayside-freight:senior-engineer",
    ]);
    const evidence = texts(inSlot(facts, "evidence"));
    expect(evidence).toContain(
      "Built a NestJS reporting service for dock invoices",
    );
    expect(evidence).toContain(
      "Rewrote the berth scheduler in Go for the harbour pilots",
    );
    expect(evidence).not.toContain(
      "Shipped a Rails booking flow for ferry crews",
    );
  });

  it("gives the coach fewer of the same facts, and says the rest were over its limit", () => {
    const question =
      "Which of these have you used in production: NestJS, Go, PostgreSQL?";
    const coach = pack.view("coach", question);
    const inspect = pack.view("inspect", question);
    const coachEvidence = inSlot(coach.selected, "evidence");
    const inspectEvidence = inSlot(inspect.selected, "evidence");
    expect(coachEvidence.length).toBe(6);
    expect(inspectEvidence.length).toBe(9);
    // The coach's are the first of the inspector's: one ranking, cut shorter.
    expect(coachEvidence).toEqual(inspectEvidence.slice(0, 6));
    expect(
      coach.excluded
        .filter((fact) => fact.reason === "limit")
        .map((fact) => fact.id)
        .sort(),
    ).toEqual(
      inspectEvidence
        .slice(6)
        .map((fact) => fact.id)
        .sort(),
    );
  });
});

describe("what the employer wants", () => {
  // ADR-0038: "An employer's requirement is never turned into a claim about
  // the candidate." Scenario 3: "The posting's requirement is not offered as
  // experience."
  it("is selected as the employer's, and covers nothing of the candidate's", () => {
    const view = pack.view("inspect", "Do you know Elixir?");
    expect(
      inSlot(view.selected, "requirements").map((fact) => [
        fact.text,
        fact.kind,
        fact.about,
      ]),
    ).toEqual([
      ["Elixir at scale", KINDS.requirement, "employer"],
      ["Elixir", KINDS.requirement, "employer"],
    ]);
    // The person has no Elixir: no evidence is selected for it.
    expect(inSlot(view.selected, "evidence")).toEqual([]);
    expect(view.slots).toContainEqual({
      slot: "evidence",
      state: "no-such-fact",
      count: 0,
    });
    expect(view.slots).toContainEqual({
      slot: "requirements",
      state: "covered",
      count: 2,
    });
  });

  it("is never returned as about the candidate, whatever is asked and whoever reads", () => {
    const employers: string[] = [
      KINDS.employer,
      KINDS.requirement,
      KINDS.employerFact,
      KINDS.prep,
    ];
    let seen = 0;
    for (const projection of Object.values(PROJECTIONS))
      for (const question of QUESTIONS) {
        const view = pack.view(projection, question);
        for (const fact of [...view.selected, ...view.excluded]) {
          const theirs =
            employers.includes(fact.kind) ||
            fact.id.startsWith("brief:") ||
            fact.id === "employer";
          if (theirs) seen += 1;
          expect(fact.about === "employer", `${question}: ${fact.id}`).toBe(
            theirs,
          );
          expect(fact.about === "candidate", `${question}: ${fact.id}`).toBe(
            fact.kind.startsWith("candidate-") &&
              fact.kind !== KINDS.preference,
          );
        }
      }
    expect(seen).toBeGreaterThan(0);
  });

  // DEFECT (sources.ts:149 with recipe.ts FILLER): every company fact
  // carries the label "company business", and "know" is not a filler
  // word, so any "Do you know …?" selects every company fact whatever it is
  // about. Since pack.ts:157 offers the recent roles only when nothing at
  // all was selected, that stray fact is then the only thing a "Do you know
  // Rust?" is given.
  it("is not selected by the word 'know' in a question about something else", () => {
    const facts = pack.facts("coach", "Do you know Rust?");
    expect(texts(inSlot(facts, "employer"))).toEqual([]);
  });

  it("is selected beside the candidate's own evidence of the same technology, each as whose it is", () => {
    const facts = pack.facts("inspect", "Tell me about your NestJS work");
    expect(
      facts
        .filter((fact) => /nestjs/i.test(fact.text))
        .map((fact) => [fact.text, fact.about, fact.slot]),
    ).toEqual([
      [
        "Built a NestJS reporting service for dock invoices",
        "candidate",
        "evidence",
      ],
      ["Five years of NestJS in production", "employer", "requirements"],
    ]);
  });
});

describe("a question about what the person wants", () => {
  it("finds the pay preference when asked about salary", () => {
    const facts = pack.facts("coach", "What are your salary expectations?");
    expect(inSlot(facts, "preferences")).toEqual([
      {
        id: expect.stringMatching(/^preference:[0-9a-f]{12}$/),
        pointer: "/context/candidatePreferences/0",
        text: "Base salary: 140k minimum.",
        kind: KINDS.preference,
        about: "preference",
        slot: "preferences",
        exact: false,
      },
    ]);
  });

  it("finds it through the alias when the question uses another word for it", () => {
    // The preference says "salary"; neither question does.
    for (const question of [
      "What compensation are you looking for?",
      "And on compensation?",
    ])
      expect(
        texts(inSlot(pack.facts("coach", question), "preferences")),
        question,
      ).toEqual(["Base salary: 140k minimum."]);
    // "start" is another word for the notice period.
    expect(
      texts(
        inSlot(pack.facts("coach", "When could you start?"), "preferences"),
      ),
    ).toEqual(["Notice period: four weeks."]);
  });

  // DEFECT (recipe.ts:107-123): an alias is read one way only, from the
  // word asked to the words listed under it. "availability", "pay" and
  // "remuneration" are listed under "notice" and "salary" and are not keys
  // themselves, so a question that uses them finds nothing ("What is your
  // availability?" does not find "Notice period: four weeks."). The same
  // holds for "postgresql" against a role that lists "Postgres", and "k8s"
  // against "Kubernetes".
  it("finds it whichever of two words that mean the same is the one asked", () => {
    expect(
      texts(
        inSlot(
          pack.facts("coach", "What is your availability?"),
          "preferences",
        ),
      ),
    ).toEqual(["Notice period: four weeks."]);
    expect(
      texts(
        inSlot(pack.facts("coach", "What pay are you after?"), "preferences"),
      ),
    ).toEqual(["Base salary: 140k minimum."]);
  });

  it("leaves the other preferences out for relevance", () => {
    const view = pack.view("coach", "What are your salary expectations?");
    expect(
      view.excluded
        .filter((fact) => fact.slot === "preferences")
        .map((fact) => [fact.text, fact.reason, fact.about])
        .sort(),
    ).toEqual([
      ["Notice period: four weeks.", "relevance", "preference"],
      ["Prefers small squads", "relevance", "preference"],
      ["Remote first!", "relevance", "preference"],
    ]);
  });
});

describe("a question for the interviewer", () => {
  it("selects the questions the person prepared to ask", () => {
    const facts = pack.facts("coach", "Do you have any questions for us?");
    expect(inSlot(facts, "prep")).toEqual([
      {
        id: expect.stringMatching(/^brief:questionsToAsk:[0-9a-f]{12}$/),
        // A brief line has no position of its own: it is pointed at by name.
        pointer: expect.stringMatching(/^brief:questionsToAsk:/),
        text: "How does the group decide what to build next?",
        kind: KINDS.prep,
        about: "employer",
        slot: "prep",
        exact: false,
      },
    ]);
    expect(inSlot(facts, "evidence")).toEqual([]);
  });
});

describe("a question a chosen story answers", () => {
  const question = "Tell me about a conflict with a stakeholder";

  it("leads with the story, then the evidence and the role of the role the story names", () => {
    const facts = pack.facts("coach", question).filter((fact) => !fact.exact);
    expect(facts[0]).toEqual({
      id: expect.stringMatching(/^story:[0-9a-f]{12}$/),
      pointer: "/story_selector/0",
      text: 'For "conflict with a stakeholder": The Quayside Freight invoice dispute with the finance director (or: The pilots\' rota disagreement)',
      kind: KINDS.story,
      about: "candidate",
      slot: "stories",
      exact: false,
    });
    // The question never said "Quayside": the story did.
    const evidence = inSlot(facts, "evidence");
    expect(texts(evidence).slice(0, 3).sort()).toEqual(
      [
        "Built a NestJS reporting service for dock invoices",
        "Reviewed every change to the invoice ledger",
        "invoices per day: 42000",
      ].sort(),
    );
    for (const fact of evidence.slice(0, 3))
      expect(fact.id).toMatch(/^role:quayside-freight:senior-engineer:/);
    expect(inSlot(facts, "roles").map((fact) => fact.id)).toEqual([
      "role:quayside-freight:senior-engineer",
    ]);
    expect(facts.map((fact) => fact.slot)).toEqual([
      "stories",
      ...evidence.map(() => "evidence"),
      "roles",
    ]);
  });

  it("does not pull the story for a question it is not for", () => {
    expect(inSlot(pack.facts("coach", GO), "stories")).toEqual([]);
  });

  it("selects by the question alone when no story is for it", async () => {
    const storyless = await packOf(
      contextOf({}, { ...MATRIX, story_selector: [] } as CandidateMatrix),
    );
    const facts = storyless.facts("coach", question);
    expect(inSlot(facts, "stories")).toEqual([]);
    expect(inSlot(facts, "evidence")).toEqual([]);
  });
});

describe("a question none of the person's facts answers", () => {
  const question = "Tell me about yourself";

  it("offers their recent roles, newest first, as the roles slot", () => {
    const facts = pack.facts("coach", question).filter((fact) => !fact.exact);
    expect(facts.map((fact) => [fact.slot, fact.id, fact.pointer])).toEqual([
      ["roles", "role:harbourline:staff-engineer", "/roles/0"],
      ["roles", "role:quayside-freight:senior-engineer", "/roles/1"],
      ["roles", "role:tidewater-labs:engineer", "/roles/2"],
    ]);
    for (const fact of facts) expect(fact.about).toBe("candidate");
  });

  it("offers no more than three, the most recent", async () => {
    const five = await packOf(
      contextOf({ brief: null, candidatePreferences: null }, {
        candidate: {},
        roles: [1, 2, 3, 4, 5].map((n) => ({
          company: `Employer ${n}`,
          title: "Engineer",
        })),
      } as CandidateMatrix),
    );
    expect(
      five.facts("coach", question).map((fact) => [fact.slot, fact.pointer]),
    ).toEqual([
      ["roles", "/roles/0"],
      ["roles", "/roles/1"],
      ["roles", "/roles/2"],
    ]);
  });

  it("offers none when a fact of theirs does answer, or the employer's material does", () => {
    expect(inSlot(pack.facts("coach", GO), "roles").length).toBe(1);
    const elixir = pack.facts("coach", "Do you know Elixir?");
    expect(inSlot(elixir, "requirements").length).toBe(2);
    expect(inSlot(elixir, "roles")).toEqual([]);
    const asking = pack.facts("coach", "Do you have any questions for us?");
    expect(inSlot(asking, "prep").length).toBe(1);
    expect(inSlot(asking, "roles")).toEqual([]);
  });

  it("offers nothing when nothing was asked: the selection is by priority alone", () => {
    const facts = pack.facts("coach", "");
    expect(inSlot(facts, "evidence").length).toBe(6);
    expect(inSlot(facts, "stories").length).toBe(1);
  });

  // DEFECT (pack.ts:177-182): the recent roles are appended to `selected`
  // only. The same three roles stay in `excluded` with the reason
  // "relevance", the `roles` slot still says "no-such-fact" with a count of
  // 0, and the digest is the one of the selection without them. So the view
  // a person inspects lists a fact as both given to the model and left out,
  // which ADR-0038 rules out ("The model receives the selected facts; the
  // inspector shows the same list and the same cut").
  it("shows the offered roles as selected and nowhere as left out", () => {
    const view = pack.view("coach", question);
    const offered = inSlot(view.selected, "roles").map((fact) => fact.id);
    expect(offered.length).toBe(3);
    expect(view.excluded.filter((fact) => offered.includes(fact.id))).toEqual(
      [],
    );
  });
  it("counts the offered roles in the state of the roles slot", () => {
    const view = pack.view("coach", question);
    expect(view.slots.find((slot) => slot.slot === "roles")).toEqual({
      slot: "roles",
      state: "covered",
      count: inSlot(view.selected, "roles").length,
    });
  });
});

describe("the same selection, reproduced", () => {
  it("has the same digest for the same material, projection and question", async () => {
    const again = await packOf();
    for (const projection of Object.values(PROJECTIONS)) {
      const first = pack.view(projection, GO);
      expect(first.digest).toMatch(/^[0-9a-f]{8,}$/);
      expect(pack.view(projection, GO).digest).toBe(first.digest);
      expect(again.view(projection, GO)).toEqual(first);
    }
  });

  it("has another digest for another question, another projection or other material", async () => {
    const digests = new Set(
      QUESTIONS.flatMap((question) =>
        Object.values(PROJECTIONS).map(
          (projection) => pack.view(projection, question).digest,
        ),
      ),
    );
    expect(digests.size).toBe(QUESTIONS.length * 3);

    const edited = await packOf(contextOf({ candidatePreferences: "Remote." }));
    expect(edited.view("inspect", GO).digest).not.toBe(
      pack.view("inspect", GO).digest,
    );
  });

  it("has the same digest for the same words asked with other filler", () => {
    expect(pack.view("coach", "So, um, have you used Go?").digest).toBe(
      pack.view("coach", GO).digest,
    );
  });
});

describe("the view a person inspects", () => {
  it("says what was asked, the words of it that selected, and what it was read from", () => {
    const view = pack.view("inspect", GO);
    expect(Object.keys(view).sort()).toEqual([
      "digest",
      "excluded",
      "projection",
      "records",
      "selected",
      "slots",
      "sources",
      "spoken",
      "terms",
    ]);
    expect(view).toMatchObject({
      projection: "inspect",
      spoken: GO,
      terms: "used go",
      records: pack.prepared.records.length,
      sources: [
        { id: "matrix:profile-1", revision: "3" },
        {
          id: "brief:candidacy-1",
          revision: expect.stringMatching(/^[0-9a-f]{16}$/),
        },
        { id: "preferences:draft", revision: "2" },
      ],
    });
  });

  it("accounts for every ranked record once: selected, or left out with a reason", () => {
    for (const question of [GO, "", "What are your salary expectations?"]) {
      const view = pack.view("inspect", question);
      const ranked = view.selected.filter((fact) => !fact.exact);
      const ids = [...ranked, ...view.excluded].map((fact) => fact.id);
      expect(new Set(ids).size, question).toBe(ids.length);
      // Everything but the two looked-up records (the profile, the employer).
      expect(ids.length, question).toBe(view.records - 2);
      for (const fact of view.excluded) {
        expect(fact.reason, fact.id).toMatch(
          /^(budget|exclusion|excluded|relevance|limit|over-limit|scope)$/,
        );
        expect(Object.keys(fact).sort()).toEqual([
          "about",
          "id",
          "kind",
          "pointer",
          "reason",
          "slot",
          "text",
        ]);
      }
    }
  });

  it("gives each slot's state: covered, known but empty, or no such fact", async () => {
    const partial = await packOf(
      contextOf({}, {
        ...MATRIX,
        candidate: { name: "Mira Okonjo" },
      } as CandidateMatrix),
    );
    expect(partial.view("inspect", GO).slots).toEqual([
      { slot: "candidate.name", state: "covered", count: 1 },
      // Asked for by the recipe, not given by the material.
      { slot: "candidate.headline", state: "known-empty", count: 0 },
      { slot: "candidate.location", state: "known-empty", count: 0 },
      { slot: "employer.company", state: "covered", count: 1 },
      { slot: "employer.role", state: "covered", count: 1 },
      { slot: "stories", state: "no-such-fact", count: 0 },
      { slot: "evidence", state: "covered", count: 6 },
      { slot: "roles", state: "covered", count: 1 },
      { slot: "preferences", state: "no-such-fact", count: 0 },
      { slot: "requirements", state: "no-such-fact", count: 0 },
      { slot: "employer", state: "no-such-fact", count: 0 },
      { slot: "prep", state: "no-such-fact", count: 0 },
    ]);
  });

  it("counts in each slot exactly the facts selected for it", () => {
    for (const question of [GO, "", "Do you know Elixir?"]) {
      const view = pack.view("inspect", question);
      for (const slot of view.slots)
        expect(slot.count, `${question}: ${slot.slot}`).toBe(
          inSlot(view.selected, slot.slot).length,
        );
    }
  });

  // ADR-0038, the third difference: "A proof point of 400 characters reaches
  // the model and one of 401 does not, while the facts view shows both."
  // Scenario 3: "Cut: reason over the per-fact limit; shown in the inspector
  // with that reason."
  it("shows a fact over the per-fact limit as cut for that reason, and gives it to no reader", async () => {
    const over = "Go ".repeat(134).trim();
    const fits = over.slice(0, 400);
    expect([over.length, fits.length]).toEqual([401, 400]);
    const long = await packOf(
      contextOf({}, {
        ...MATRIX,
        roles: [{ ...HARBOURLINE, proof_points: [over, fits] }, QUAYSIDE],
      } as CandidateMatrix),
    );
    const view = long.view("inspect", GO);
    expect(texts(view.selected)).toContain(fits);
    expect(texts(view.selected)).not.toContain(over);
    expect(texts(long.facts("inspect", GO))).not.toContain(over);
    expect(view.excluded.filter((fact) => fact.text === over)).toEqual([
      {
        id: expect.stringMatching(
          /^role:harbourline:staff-engineer:proof_points:/,
        ),
        pointer: "/roles/0/proof_points/0",
        text: over,
        kind: KINDS.evidence,
        about: "candidate",
        slot: "evidence",
        reason: "over-limit",
      },
    ]);
  });
});

describe("a person's pin or exclusion", () => {
  // ADR-0038: "A person's pin or exclusion outranks any score."
  it("outranks the score", () => {
    const pinned = "role:tidewater-labs:engineer";
    const excluded = "role:harbourline:staff-engineer";
    const resolved = pack.resolve("coach", GO, {
      pinned: [pinned],
      excluded: [excluded],
    });
    expect(
      resolved.selected
        .filter((fact) => fact.slot === "roles")
        .map((fact) => [fact.recordId, fact.score.pinned]),
    ).toEqual([[pinned, true]]);
    expect(resolved.excluded).toContainEqual({
      recordId: excluded,
      slot: "roles",
      reason: "excluded",
    });
  });
});

describe("a session's material as sources", () => {
  it("is the matrix, the brief and the preferences, each at its revision", () => {
    const sources = sessionSources(contextOf());
    expect(
      sources.map(({ id, revision, kind }) => ({ id, revision, kind })),
    ).toEqual([
      { id: "matrix:profile-1", revision: "3", kind: "experience-matrix" },
      {
        id: "brief:candidacy-1",
        revision: expect.stringMatching(/^[0-9a-f]{16}$/),
        kind: "employer-brief",
      },
      {
        id: "preferences:draft",
        revision: "2",
        kind: "candidate-preferences",
      },
    ]);
    for (const source of sources)
      expect(source.records?.length).toBeGreaterThan(0);
  });

  it("revises the brief when what it says changes, and only then", () => {
    const revisionOf = (brief: typeof BRIEF) =>
      sessionSources(
        contextOf({ brief: { ...brief, candidacyId: "candidacy-1" } }),
      )[1]?.revision;
    expect(revisionOf(BRIEF)).toBe(revisionOf({ ...BRIEF }));
    expect(revisionOf({ ...BRIEF, values: ["Ship on Fridays"] })).not.toBe(
      revisionOf(BRIEF),
    );
  });

  it("counts preferences with no draft revision as revision 0", () => {
    expect(
      sessionSources(contextOf({ draftRevision: null })).at(-1),
    ).toMatchObject({ id: "preferences:draft", revision: "0" });
  });

  it("is each part only when the session has it", () => {
    const ids = (context: ReturnType<typeof contextOf>) =>
      sessionSources(context).map((source) => source.id);
    expect(ids(contextOf({ brief: null }))).toEqual([
      "matrix:profile-1",
      "preferences:draft",
    ]);
    expect(ids(contextOf({ candidatePreferences: null }))).toEqual([
      "matrix:profile-1",
      "brief:candidacy-1",
    ]);
    expect(ids(contextOf({ candidatePreferences: "" }))).toEqual([
      "matrix:profile-1",
      "brief:candidacy-1",
    ]);
    // A matrix needs its pinned profile, and a profile its matrix.
    expect(ids(contextOf({ profile: null }))).toEqual([
      "brief:candidacy-1",
      "preferences:draft",
    ]);
    expect(ids(contextOf({ profile: PROFILE }, null))).toEqual([
      "brief:candidacy-1",
      "preferences:draft",
    ]);
  });

  it("is nothing when the session pinned and linked nothing", () => {
    expect(
      sessionSources(
        contextOf(
          { profile: null, brief: null, candidatePreferences: null },
          null,
        ),
      ),
    ).toEqual([]);
  });

  it("is nothing for a context that carries no material", () => {
    const { material: _material, ...bare } = contextOf();
    expect(sessionSources(bare)).toEqual([]);
  });
});

describe("a pack of no material", () => {
  it("has no facts, no field and nothing left out, for any question or reader", async () => {
    const empty = await prepareContextPack(engine, [], EXECUTION);
    expect(empty.prepared.records).toEqual([]);
    for (const projection of Object.values(PROJECTIONS) as ProjectionId[])
      for (const question of QUESTIONS) {
        expect(empty.facts(projection, question)).toEqual([]);
        expect(empty.view(projection, question)).toMatchObject({
          records: 0,
          selected: [],
          excluded: [],
          sources: [],
        });
      }
    expect(empty.lookup("candidate.name")).toBeUndefined();
    expect(empty.lookup("employer.company")).toBeUndefined();
    const states = empty.view("inspect", GO).slots;
    expect(states.length).toBe(12);
    for (const slot of states) {
      expect(slot.count).toBe(0);
      expect(slot.state).toBe(
        slot.slot.includes(".") ? "known-empty" : "no-such-fact",
      );
    }
  });
});

describe("material the recipe does not know", () => {
  // ADR-0038 scenario 1: "Refused, naming the field; nothing is dropped
  // silently."
  it("is refused whole, naming what was wrong", async () => {
    const refused = await prepareContextPack(
      engine,
      [
        ...sessionSources(contextOf()),
        {
          id: "notes:1",
          revision: "1",
          kind: "experience-matrix",
          records: [{ id: "note:1", kind: "horoscope", text: "A good week" }],
        },
      ],
      EXECUTION,
    ).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ContextPackError);
    expect((refused as ContextPackError).reason).toContain("horoscope");
    // What the error says to a caller is fixed; the reason is beside it.
    expect((refused as ContextPackError).message).toBe(
      "The context pack could not be prepared.",
    );
  });
});

describe("a matrix with a role inserted first", () => {
  // ADR-0038 scenario 1 and the fourth difference ("Inserting a role changes
  // the address of every fact after it"): the address moves, the identity
  // does not.
  it("leaves the selected facts' identities unchanged while their pointers shift", async () => {
    const grown = await packOf(
      contextOf({}, {
        ...MATRIX,
        roles: [NEWER, ...MATRIX.roles],
      } as CandidateMatrix),
    );
    for (const question of [
      GO,
      "Tell me about a conflict with a stakeholder",
    ]) {
      const before = pack
        .facts("inspect", question)
        .filter((fact) => !fact.exact);
      const after = grown
        .facts("inspect", question)
        .filter((fact) => !fact.exact);
      expect(before.length).toBeGreaterThan(3);
      expect(
        after.map((fact) => [fact.id, fact.text, fact.slot]),
        question,
      ).toEqual(before.map((fact) => [fact.id, fact.text, fact.slot]));
      const shifted = (pointer: string) =>
        pointer.replace(/^\/roles\/(\d+)/, (_, n) => `/roles/${Number(n) + 1}`);
      expect(
        after.map((fact) => fact.pointer),
        question,
      ).toEqual(before.map((fact) => shifted(fact.pointer)));
      expect(before.some((fact) => fact.pointer.startsWith("/roles/"))).toBe(
        true,
      );
    }
    // The new role is one new role, found by what it used.
    expect(
      inSlot(grown.facts("inspect", "Any Rust?"), "roles").map((fact) => [
        fact.id,
        fact.pointer,
      ]),
    ).toEqual([["role:saltmarsh-robotics:principal-engineer", "/roles/0"]]);
  });
});
