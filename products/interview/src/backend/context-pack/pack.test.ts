// The context pack (ADR-0038) on a real AI engine with no model behind it: a
// session's approved material prepared into records, then resolved for one
// question. Structured sources call no model, so the engine here has no
// profile and no provider; a call to one would fail the suite. Every name
// and figure is invented.
import { createAiEngine } from "@omnitech/ai-engine";
import type { CandidateMatrix } from "@omnitech/interview-contracts";
import { beforeAll, describe, expect, it } from "vitest";
import { preparePackForBench, readFixture } from "./bench";
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

// An achievement as it reads: who, where, when and what, then the stack.
const HARBOUR = "At Harbourline (2022 to 2025, Staff Engineer)";
const HARBOUR_STACK = "Stack: Go, PostgreSQL, Kafka.";
const QUAY = "At Quayside Freight (Senior Engineer)";
const QUAY_STACK = "Stack: NestJS, TypeScript, Redis.";
const REWROTE = `${HARBOUR}: Rewrote the berth scheduler in Go for the harbour pilots. ${HARBOUR_STACK}`;
const NEST = `${QUAY}: Built a NestJS reporting service for dock invoices. ${QUAY_STACK}`;
const REVIEWED = `${QUAY}: Reviewed every change to the invoice ledger. ${QUAY_STACK}`;
const INVOICES = `${QUAY}: invoices per day: 42000. ${QUAY_STACK}`;
const RAILS =
  "At Tidewater Labs (Engineer): Shipped a Rails booking flow for ferry crews. Stack: Ruby, Rails.";

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
    // Five achievements: the role's two proof points, its signal, its
    // responsibility and the one metric no proof point states.
    expect(evidence.length).toBe(5);
    for (const fact of evidence) {
      expect(fact.id, fact.text).toMatch(/^role:harbourline:staff-engineer:/);
      expect(fact.pointer, fact.text).toMatch(/^\/roles\/0\//);
      expect(fact.text.startsWith(`${HARBOUR}: `), fact.text).toBe(true);
      expect(fact).toMatchObject({
        kind: KINDS.achievement,
        about: "candidate",
        exact: false,
      });
    }
    // The achievement that names Go leads the ones merely done on it.
    expect(texts(evidence)[0]).toBe(REWROTE);
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
      [NEST, REVIEWED, INVOICES, RAILS].sort(),
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
    expect(evidence).toContain(NEST);
    expect(evidence).toContain(REWROTE);
    expect(evidence).not.toContain(RAILS);
  });

  it("gives the coach four of the same facts, and says the rest were over its limit", () => {
    const question =
      "Which of these have you used in production: NestJS, Go, PostgreSQL?";
    const coach = pack.view("coach", question);
    const inspect = pack.view("inspect", question);
    const coachEvidence = inSlot(coach.selected, "evidence");
    const inspectEvidence = inSlot(inspect.selected, "evidence");
    expect(coachEvidence.length).toBe(4);
    expect(inspectEvidence.length).toBe(8);
    // One ranking: the coach is given none the inspector is not.
    for (const fact of coachEvidence)
      expect(inspectEvidence).toContainEqual(fact);
    expect(
      coach.excluded
        .filter((fact) => fact.reason === "limit")
        .map((fact) => fact.id)
        .sort(),
    ).toEqual(
      inspectEvidence
        .filter((fact) => !coachEvidence.some((kept) => kept.id === fact.id))
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
      // The achievement that names NestJS, then the others done on it.
      [NEST, "candidate", "evidence"],
      [INVOICES, "candidate", "evidence"],
      [REVIEWED, "candidate", "evidence"],
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
      [NEST, REVIEWED, INVOICES].sort(),
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
    // The coach's four places: three from the newest role, best first, and
    // the next role's best. Nothing was asked, so neither role dominates.
    expect(inSlot(facts, "evidence").map((fact) => fact.pointer)).toEqual([
      "/roles/0/proof_points/0",
      "/roles/0/proof_points/1",
      "/roles/0/metrics/0",
      "/roles/1/proof_points/0",
    ]);
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
      // The engine's digest, marked when the places were then filled by the
      // recipe's rules (the coach has four places for Harbourline's five).
      expect(first.digest).toMatch(/^[0-9a-f]{8,}(\+arranged)?$/);
      expect(first.digest.endsWith("+arranged")).toBe(projection === "coach");
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
      terms: "go",
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
      { slot: "evidence", state: "covered", count: 5 },
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
    // The limit is on the whole fact a model reads: the achievement with
    // its role, not the proof point alone.
    const whole = (said: string) => `${HARBOUR}: ${said}. ${HARBOUR_STACK}`;
    const said = (length: number) =>
      `Go ${"x".repeat(length - whole("Go ").length)}`;
    const [over, fits] = [said(401), said(400)];
    expect([whole(over).length, whole(fits).length]).toEqual([401, 400]);
    const long = await packOf(
      contextOf({}, {
        ...MATRIX,
        roles: [{ ...HARBOURLINE, proof_points: [over, fits] }, QUAYSIDE],
      } as CandidateMatrix),
    );
    const view = long.view("inspect", GO);
    expect(texts(view.selected)).toContain(whole(fits));
    expect(texts(view.selected)).not.toContain(whole(over));
    expect(texts(long.facts("inspect", GO))).not.toContain(whole(over));
    expect(view.excluded.filter((fact) => fact.text === whole(over))).toEqual([
      {
        id: expect.stringMatching(
          /^role:harbourline:staff-engineer:proof_points:/,
        ),
        pointer: "/roles/0/proof_points/0",
        text: whole(over),
        kind: KINDS.achievement,
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

// The benchmark's brief: thirteen roles, sixteen prep notes and the traps a
// real application showed (an old role that says "migration", a technology
// the matrix names differently, a note that names its proof). Invented.
describe("evidence for a question, on a whole brief", () => {
  let kestrel: ContextPack;
  beforeAll(async () => {
    kestrel = await preparePackForBench(
      readFixture("kestrel-freight-pay").material,
    );
  });
  const company = (id: string) =>
    String(
      kestrel.prepared.records.find((record) => record.id === id)?.fields?.[
        "company"
      ],
    );
  const evidenceFor = (question: string, projection: ProjectionId = "coach") =>
    inSlot(kestrel.facts(projection, question), "evidence");
  const employers = (question: string, projection: ProjectionId = "coach") =>
    evidenceFor(question, projection).map((fact) => company(fact.id));
  const leading = (question: string, slot: string) =>
    inSlot(kestrel.facts("coach", question), slot)[0]?.text ?? "";

  describe("a note that names its proof", () => {
    const question = "How would you move a service from MongoDB to PostgreSQL?";

    // The note says "Proof: Copperleaf, 3M+ learners"; an older role lists
    // both databases and used to win on that alone.
    it("brings the named employer's achievements first, the one whose figure it states leading", () => {
      expect(leading(question, "prep")).toMatch(/^MongoDB to PostgreSQL/);
      expect(employers(question)).toEqual([
        "Copperleaf Learning",
        "Copperleaf Learning",
        "Copperleaf Learning",
        "Vantage Networks",
      ]);
      expect(evidenceFor(question)[0]?.text).toContain(
        "Kept roster drift near zero across 3M+ learner accounts",
      );
    });

    it("orders what it names by the question first: the modernization itself before its results", () => {
      const migration = "Tell me about a time you led a migration.";
      expect(leading(migration, "prep")).toMatch(/^Modernization/);
      expect(evidenceFor(migration)[0]?.text).toContain(
        "Led modernization of the legacy PHP monolith",
      );
      // The 2008 role files itself under "migration" and no longer leads.
      expect(employers(migration)).not.toContain("Northgate Cable");
    });

    it("answers a question none of the record's words answer", () => {
      // The note is headed with the question; the record never says it.
      expect(leading("Tell me about yourself.", "prep")).toMatch(
        /^Tell me about yourself/,
      );
      expect(employers("Tell me about yourself.")).toEqual([
        "Larchmont Pay",
        "Larchmont Pay",
        "Larchmont Pay",
        "Quotewright",
      ]);
    });
  });

  describe("a technology the person's record names differently", () => {
    // The matrix says "Node.js"; the brief asks for NestJS; one note says
    // NestJS beside one employer.
    it("is found through the note that ties it to an employer", () => {
      const question = "What is your experience with NestJS?";
      expect(leading(question, "prep")).toMatch(/^NestJS:/);
      expect(new Set(employers(question))).toEqual(new Set(["Larchmont Pay"]));
      for (const fact of evidenceFor(question))
        expect(fact.text).not.toMatch(/nestjs/i);
    });

    it("follows only the technology the question names, of a requirement that names several", () => {
      // "Strong TypeScript and Node on the server; NestJS preferred": this
      // question is about TypeScript, which Larchmont Pay never used.
      expect(
        employers("How much TypeScript have you written on the server?"),
      ).not.toContain("Larchmont Pay");
    });
  });

  describe("a requirement that names a technology", () => {
    it("brings the achievements done on it when the question does not name it", () => {
      // "Event-driven design with a message broker such as Kafka": only one
      // role's stack has Kafka, and no line of it says "event".
      const from = employers(
        "How do you design event-driven systems around a message broker?",
      );
      expect(from.slice(0, 3)).toEqual([
        "Vantage Networks",
        "Vantage Networks",
        "Vantage Networks",
      ]);
      // The fourth place is a backup found by the question's own words.
      expect(from[3]).not.toBe("Vantage Networks");
    });

    it("links nothing when it was only found in passing", () => {
      // "Moving a service from MongoDB to PostgreSQL" shares one word with
      // this question; its databases are not what was asked.
      const question = "When would you split a service out of a monolith?";
      expect(employers(question)[0]).toBe("Larchmont Pay");
      expect(evidenceFor(question)[0]?.text).toContain("monolith");
    });
  });

  describe("the places a projection has for evidence", () => {
    const QUESTIONS_ASKED = readFixture(
      "kestrel-freight-pay",
    ).gold.questions.map((each) => each.question);

    it("go to at most two roles for the coach and an answer, the primary first", () => {
      for (const [projection, places, lead] of [
        ["coach", 4, 3],
        ["answer", 6, 4],
      ] as const)
        for (const question of QUESTIONS_ASKED) {
          const from = employers(question, projection);
          expect(from.length, question).toBeLessThanOrEqual(places);
          const roles = [...new Set(from)];
          expect(roles.length, question).toBeLessThanOrEqual(2);
          // One role's achievements are together, never interleaved.
          expect(from.join("|"), question).toBe(
            roles
              .flatMap((role) => from.filter((each) => each === role))
              .join("|"),
          );
          // The backup never takes more than the primary leaves it.
          if (roles.length === 2)
            expect(
              from.filter((each) => each === roles[1]).length,
              question,
            ).toBeLessThanOrEqual(
              Math.max(
                places - lead,
                places - from.filter((each) => each === roles[0]).length,
              ),
            );
        }
    });

    it("are not kept to two roles for the view a person inspects", () => {
      expect(
        new Set(
          employers(
            "How much TypeScript have you written on the server?",
            "inspect",
          ),
        ).size,
      ).toBeGreaterThan(2);
    });

    it("leave the backup out when the primary clearly dominates", () => {
      // The linked role takes every place: nothing else matches a word of
      // the question, so there is no backup to give the fourth place to.
      const from = employers("What is your experience with NestJS?");
      expect(new Set(from).size).toBe(1);
      expect(from.length).toBe(4);
    });

    it("say what was left out for want of a place, with the engine's own reason", () => {
      const question = "Tell me about a time you led a migration.";
      const view = kestrel.view("coach", question);
      const kept = inSlot(view.selected, "evidence").map((fact) => fact.id);
      const left = view.excluded.filter(
        (fact) => fact.slot === "evidence" && fact.reason === "limit",
      );
      expect(left.length).toBeGreaterThan(0);
      for (const fact of left) expect(kept).not.toContain(fact.id);
      expect(view.slots).toContainEqual({
        slot: "evidence",
        state: "covered",
        count: kept.length,
      });
      // Every achievement is accounted for once.
      const all = [
        ...kept,
        ...view.excluded
          .filter((fact) => fact.slot === "evidence")
          .map((fact) => fact.id),
      ];
      expect(new Set(all).size).toBe(all.length);
      expect(all.length).toBe(
        kestrel.prepared.records.filter(
          (record) => record.kind === KINDS.achievement,
        ).length,
      );
    });

    it("keep a person's pin first, whatever its role", () => {
      const question = "Tell me about a time you led a migration.";
      const pinned = kestrel.prepared.records.find(
        (record) =>
          record.kind === KINDS.achievement &&
          record.fields?.["company"] === "Pixelforge",
      )?.id as string;
      const resolved = kestrel.resolve("coach", question, { pinned: [pinned] });
      const evidence = resolved.selected.filter(
        (fact) => fact.slot === "evidence",
      );
      expect(evidence[0]?.recordId).toBe(pinned);
      expect(evidence.length).toBe(4);
      // The pin took a place; the two roles share the other three.
      expect(
        new Set(evidence.slice(1).map((fact) => company(fact.recordId))).size,
      ).toBeLessThanOrEqual(2);
    });
  });

  describe("a chosen story's words", () => {
    const question = "How do you mentor engineers?";

    it("find the person's own record", () => {
      expect(leading(question, "stories")).toMatch(
        /^For "staff-level mentoring \/ standards": Larchmont Pay/,
      );
      expect(employers(question)[0]).toBe("Larchmont Pay");
    });

    // The story names "Larchmont Pay", and "pay" is another word for
    // salary: the story's words must not reach the person's preferences or
    // re-order the notes they prepared.
    it("do not reach the person's preferences, the employer's material or the prep notes", () => {
      const facts = kestrel.facts("coach", question);
      expect(texts(inSlot(facts, "preferences"))).not.toContain(
        "Base salary: 185k CAD minimum, target 200k.",
      );
      expect(leading(question, "prep")).toMatch(
        /^DORA, mentoring, disagreement/,
      );
      // The view says the words the question itself came to.
      expect(kestrel.view("coach", question).terms).toBe("mentor engineers");
    });
  });

  describe("a question the material has an answer for only in other words", () => {
    it("finds the pay preference, and the notice period for a start date", () => {
      expect(leading("What are your salary expectations?", "preferences")).toBe(
        "Base salary: 185k CAD minimum, target 200k.",
      );
      expect(leading("When could you start?", "preferences")).toBe(
        "Notice period: three weeks.",
      );
    });

    it("finds the note on disagreement for a question about a conflict", () => {
      expect(
        leading("Tell me about a conflict with a stakeholder.", "prep"),
      ).toMatch(/^DORA, mentoring, disagreement/);
    });

    it("finds the note headed with the topic before one that says it in passing", () => {
      // "Round: … leadership and experience deep dive" used to lead here.
      expect(
        leading("How would you structure a NestJS module for payouts?", "prep"),
      ).toMatch(/^NestJS:/);
      expect(leading("Why are you leaving your current role?", "prep")).toMatch(
        /^Answer shape: .*Why leaving Larchmont Pay/,
      );
    });
  });

  describe("a question the material has nothing for", () => {
    it.each(["Do you know Elixir?", "Any Rust or Haskell in your background?"])(
      "offers no evidence, no note and no preference for: %s",
      (question) => {
        const facts = kestrel
          .facts("coach", question)
          .filter((fact) => !fact.exact);
        // Only the recent roles, offered because nothing was found.
        expect(facts.map((fact) => fact.slot)).toEqual([
          "roles",
          "roles",
          "roles",
        ]);
        expect(kestrel.view("coach", question).digest).toMatch(
          /\+recent-roles$/,
        );
      },
    );
  });

  it("gives the reader and the view the same selection, for every question and projection", () => {
    for (const projection of Object.values(PROJECTIONS))
      for (const { question } of readFixture("kestrel-freight-pay").gold
        .questions) {
        const view = kestrel.view(projection, question);
        expect(view.selected, `${projection}: ${question}`).toEqual(
          kestrel.facts(projection, question),
        );
        // Each slot counts exactly what was selected for it.
        for (const slot of view.slots)
          expect(slot.count, `${question}: ${slot.slot}`).toBe(
            inSlot(view.selected, slot.slot).length,
          );
        // Nothing is both given and left out.
        const given = new Set(
          view.selected.map((fact) => `${fact.slot}:${fact.id}`),
        );
        for (const fact of view.excluded)
          expect(given.has(`${fact.slot}:${fact.id}`), fact.id).toBe(false);
        expect(kestrel.view(projection, question).digest).toBe(view.digest);
      }
  });
});
