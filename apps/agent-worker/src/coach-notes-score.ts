// What a replayed coach's note SAYS, scored against what was expected of it.
//
// PROBLEM: a replay scored WHEN the coach acts; nothing said whether the note
// it then wrote drew on the right employer's record, or put a figure in the
// person's mouth that nobody gave it. STRATEGY: three checks in code, each on
// what the coach's own verifier already marked (reply.ts): which employers the
// note's verified claims belong to, whether the facts it was given held the
// right employer's at all, and which figures and employer names it states
// that were neither in those facts nor said in the call. No model judges
// anything here, so the same note always gets the same score.
// COMPLEXITY: O(note + facts + conversation) per question.
import type { CoachPorts } from "@omnitech/product-interview/session-worker";

type CoachNote = Parameters<CoachPorts["notes"]["post"]>[0];

// A fact the coach was given for one turn: where it is, what it says, and
// whose it is (the person's record, their own notes, the employer's).
export type GivenFact = { pointer: string; text: string; about?: string };

// What `expected.json` says of one question's evidence. "employers": a right
// note may draw on these employers' records. "nothing": the material has
// nothing for it, and a right note invents no employer and no figure.
export type EvidenceExpectation =
  | { kind: "employers"; accepted: readonly string[] }
  | { kind: "nothing" };

// [DOMAIN] `"evidence": ["Employer A"]` names the employers; an empty list or
// `"nothing": true` says there is nothing to draw on; neither says no
// expectation at all, and the question's evidence is then not scored.
export function expectationOf(question: {
  evidence?: readonly string[] | undefined;
  nothing?: boolean | undefined;
}): EvidenceExpectation | null {
  if (question.nothing === true) return { kind: "nothing" };
  if (!Array.isArray(question.evidence)) return null;
  return question.evidence.length === 0
    ? { kind: "nothing" }
    : { kind: "employers", accepted: question.evidence };
}

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

// The employer a fact belongs to: the company of the role it is under
// ("/roles/2/proof_points/1" is the third role's). Anything else (the
// person's name, a preference, the employer's own material, what a model
// extracted from the research) belongs to no employer.
export function employerOf(
  pointer: string,
  employers: readonly string[],
): string | undefined {
  const role = /^\/roles\/(\d+)(?:\/|$)/.exec(pointer)?.[1];
  return role === undefined ? undefined : employers[Number(role)];
}

// Everything a note puts in front of the person: its lines, as they read.
export function noteText(note: CoachNote): string {
  return (note.sections ?? [])
    .flatMap((section) =>
      section.lines.map((line) =>
        line.segments.map((segment) => segment.text).join(""),
      ),
    )
    .join("\n");
}

// [DOMAIN] The places in the record the note's claims were VERIFIED against,
// each once. The coach's verifier (reply.ts) marks a bold claim "verified"
// and keeps its source only when the claim's pointer is one of the facts the
// coach was given and every figure in the claim is that fact's; a claim it
// could not verify is "inferred" and has no source.
export function verifiedSources(note: CoachNote): string[] {
  const sources = (note.sections ?? []).flatMap((section) =>
    section.lines.flatMap((line) =>
      line.segments.flatMap((segment) =>
        segment.role === "evidence" &&
        segment.grounding === "verified" &&
        segment.source
          ? [segment.source]
          : [],
      ),
    ),
  );
  return [...new Set(sources)];
}
// The bold claims the coach's verifier could NOT tie to a fact of the record.
const inferredClaims = (note: CoachNote): string[] =>
  (note.sections ?? []).flatMap((section) =>
    section.lines.flatMap((line) =>
      line.segments.flatMap((segment) =>
        segment.role === "evidence" && segment.grounding !== "verified"
          ? [segment.text]
          : [],
      ),
    ),
  );

// [DOMAIN] Whether a claim RESTS ON a text: the text says every figure of the
// claim and most of the words that carry it. A word is compared by how it
// begins and a hyphen separates, so "mentoring" is "mentored" and
// "adapter-based" holds "adapter"; small words tell nothing apart. This is a
// score's reading of a note, forgiving on purpose: the coach's own verifier
// (reply.ts) is what marks a claim verified in the window, and it is not
// changed by anything here.
const RESTS_ON_SHARE = 0.6;
const SMALL = new Set(
  "a an and are as at be but by for from in is it its of on or so that the this to was we were with i my our".split(
    " ",
  ),
);
const carried = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z0-9][a-z0-9.%+#]*/g) ?? [])
    .map((word) => word.replace(/\.+$/, ""))
    .filter((word) => word !== "" && !SMALL.has(word))
    .map((word) => (/^[a-z]+$/.test(word) ? word.slice(0, 5) : word));
export function restsOn(claim: string, texts: readonly string[]): boolean {
  const wanted = carried(claim);
  if (wanted.length === 0) return false;
  const numbers = figuresIn(claim);
  return texts.some((text) => {
    const held = new Set(carried(text));
    const said = new Set(figuresIn(text));
    return (
      numbers.every((figure) => said.has(figure)) &&
      wanted.filter((word) => held.has(word)).length / wanted.length >=
        RESTS_ON_SHARE
    );
  });
}

export type EvidenceScore = {
  // Verified claims' sources under an accepted employer's role, under any
  // other employer's role, and under no role at all (or, for a question with
  // no evidence expectation, under any role: nothing is judged there).
  accepted: number;
  wrong: number;
  other: number;
  // Bold claims the verifier could not tie to a fact of the record.
  inferred: number;
  // Of those: how many rest on the person's OWN notes given for the turn
  // (what they prepared to say, what they said in an earlier stage) or on
  // the plan for the call. Theirs to say, though no part of the record.
  own: number;
  // And how many rest on nothing the coach was given and nothing said in the
  // call: the model's own.
  unbacked: number;
  // [DOMAIN] Claims the model did not cite (or cited in a way the verifier
  // does not take) that nonetheless REST ON a fact of the record it was
  // given in this call: under an accepted employer's role, and under
  // another's. The window shows them as inferred; a reader of the note would
  // call them the person's own.
  uncited: { accepted: number; wrong: number };
  // The employers of the record the note NAMES in its words: accepted ones,
  // and others. A note may name another employer for contrast; one that
  // names only others has told the wrong story.
  named: { accepted: number; other: number };
  // The pointers themselves, for whoever reads the result: where, never what.
  sources: string[];
  // Of the facts the coach was given for the turn: how many are an accepted
  // employer's, and how many another employer's.
  offeredAccepted: number;
  offeredOther: number;
  // The pack's selection held an accepted employer's fact at all. False with
  // `accepted` 0: the pack never offered it. True with `accepted` 0: it was
  // offered and the note ignored it. Null: no employer is expected.
  offered: boolean | null;
};

export function scoreEvidence(
  note: CoachNote | undefined,
  facts: readonly GivenFact[],
  expectation: EvidenceExpectation | null,
  employers: readonly string[],
  // What else the coach had: the plan for the call (the person's own), and
  // everything heard up to the turn.
  beside: {
    plan?: string | undefined;
    conversation?: readonly string[];
    // The facts given for earlier turns of the call: a model kept in one
    // session for the call still holds them.
    earlier?: readonly GivenFact[];
  } = {},
): EvidenceScore {
  const unverified = note ? inferredClaims(note) : [];
  const ownTexts = [
    ...facts.filter((fact) => fact.about === "notes").map((fact) => fact.text),
    ...(beside.plan ? beside.plan.split(/\n+/) : []),
  ];
  const otherTexts = [
    ...facts.filter((fact) => fact.about !== "notes").map((fact) => fact.text),
    ...(beside.conversation ?? []),
  ];
  const own = unverified.filter((claim) => restsOn(claim, ownTexts));
  // The record as the model holds it: this turn's facts, then the earlier.
  const record = [...facts, ...(beside.earlier ?? [])].filter(
    (fact) => fact.about === undefined || fact.about === "candidate",
  );
  const rested = unverified.flatMap((claim) => {
    const fact = record.find(
      (each) =>
        employerOf(each.pointer, employers) !== undefined &&
        restsOn(claim, [each.text]),
    );
    return fact ? [employerOf(fact.pointer, employers) as string] : [];
  });
  const text = note ? noteText(note) : "";
  const namedHere = [...new Set(employers)].filter((each) => names(text, each));
  // An employer is accepted when the expectation names it. With nothing
  // expected, every employer is a wrong one.
  const accepts = (employer: string) =>
    expectation?.kind === "employers" &&
    expectation.accepted.some((each) => same(each, employer));
  const sources = note ? verifiedSources(note) : [];
  const owners = sources.map((source) =>
    expectation === null ? undefined : employerOf(source, employers),
  );
  const offered = facts.flatMap((fact) => {
    const employer = employerOf(fact.pointer, employers);
    return employer === undefined ? [] : [employer];
  });
  const offeredAccepted = offered.filter(accepts).length;
  return {
    accepted: owners.filter((each) => each !== undefined && accepts(each))
      .length,
    wrong: owners.filter((each) => each !== undefined && !accepts(each)).length,
    other: owners.filter((each) => each === undefined).length,
    inferred: unverified.length,
    own: own.length,
    unbacked: unverified.filter(
      (claim) =>
        !own.includes(claim) &&
        !restsOn(claim, otherTexts) &&
        !restsOn(
          claim,
          record.map((fact) => fact.text),
        ),
    ).length,
    uncited: {
      accepted: rested.filter(accepts).length,
      wrong: rested.filter((each) => !accepts(each)).length,
    },
    named: {
      accepted: namedHere.filter(accepts).length,
      other: namedHere.filter((each) => !accepts(each)).length,
    },
    sources,
    offeredAccepted,
    offeredOther: offered.length - offeredAccepted,
    offered: expectation?.kind === "employers" ? offeredAccepted > 0 : null,
  };
}

// ---- Invented figures and employers -----------------------------------------

const UNITS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};
const TENS: Readonly<Record<string, number>> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

// The figures written in digits in `text`, as plain numbers: "40%", "45ms",
// "2.1M" and "3,000" are 40, 45, 2.1 and 3000. A unit or a percent sign is
// not part of the figure, so "45 ms" and "45 milliseconds" are one figure.
export function figuresIn(text: string): string[] {
  const found = text.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g);
  return [...new Set((found ?? []).map((figure) => String(Number(figure))))];
}

// The figures SAID in words, as a recogniser writes speech: "four weeks" is
// 4, "forty percent" 40, "twenty five" and "twenty-five" 25. Only whole
// numbers under a hundred: read for what was given to the coach, so a note
// that writes "40%" after someone said "forty percent" invented nothing.
function spokenFigures(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const found: string[] = [];
  for (const [at, word] of words.entries()) {
    const unit = UNITS[word];
    const tens = TENS[word];
    if (unit !== undefined) found.push(String(unit));
    if (tens !== undefined) {
      found.push(String(tens));
      const next = UNITS[words[at + 1] ?? ""];
      if (next !== undefined && next > 0 && next < 10)
        found.push(String(tens + next));
    }
  }
  return found;
}

// Whether `text` names `employer`, as a whole name and not inside a longer
// word, whatever its case.
function names(text: string, employer: string): boolean {
  const name = employer.trim().toLowerCase();
  if (name === "") return false;
  const held = text.toLowerCase();
  let at = held.indexOf(name);
  while (at !== -1) {
    const before = held[at - 1] ?? " ";
    const after = held[at + name.length] ?? " ";
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true;
    at = held.indexOf(name, at + 1);
  }
  return false;
}

export type Invented = { figures: string[]; employers: string[] };

// [DOMAIN] A figure nobody gave is not invented when it is plainly worked out
// from two that were: their difference or their sum ("780ms saved" from
// "900ms to 120ms"). Only between figures of a hundred or more: among small
// numbers almost any figure is the sum of two others, and a made-up "65%"
// would pass as "40 and 25". A year, a percentage and a small count stay
// flagged, and each still needs reading.
const DERIVED_FROM = 100;
function derived(figure: string, known: ReadonlySet<string>): boolean {
  const value = Number(figure);
  if (!Number.isInteger(value) || value <= 0) return false;
  const given = [...known]
    .map(Number)
    .filter((each) => Number.isInteger(each) && each >= DERIVED_FROM);
  for (const a of given)
    for (const b of given)
      if (a < b && (a + b === value || b - a === value)) return true;
  return false;
}

// [SAFETY] What a note states that nobody gave the coach: figures and
// employer names that are in NEITHER the text it was given for the turn (the
// facts, and the plan for the call) NOR anything said in the conversation so
// far. A simple extract-and-match, so it is a floor and not a verdict.
//
// What it CANNOT catch:
//   - an invented technology, project, team, person or outcome: only figures
//     and the matrix's own employer names are looked for;
//   - an employer that is not in the matrix at all (a company made up whole);
//   - a real figure moved to the wrong claim or the wrong employer: "40%" is
//     accepted wherever it stands if any given fact or spoken line holds 40;
//   - a figure the note writes in words ("forty percent"), or one above
//     ninety-nine that was only ever said in words;
//   - a wrong unit or scale ("45 ms" for "45 s", "2.1M" for "2.1k").
// What it may flag wrongly: a figure the note derives from given ones in a
// way `derived` does not look for ("twice", a percentage worked out), a list
// number, or a year the note states on its own.
export function inventedIn(
  note: string,
  given: readonly string[],
  employers: readonly string[],
): Invented {
  const held = given.join("\n");
  const known = new Set([...figuresIn(held), ...spokenFigures(held)]);
  return {
    figures: figuresIn(note).filter(
      (figure) => !known.has(figure) && !derived(figure, known),
    ),
    employers: [...new Set(employers.map((employer) => employer.trim()))]
      .filter((employer) => names(note, employer) && !names(held, employer))
      .sort(),
  };
}

// ---- One question, then the run ---------------------------------------------

export type NoteScore = {
  evidence: EvidenceScore;
  invented: { figures: number; employers: number };
  // Null when the question carries no evidence expectation. With employers
  // expected: at least one verified claim is an accepted employer's and none
  // is another employer's. With nothing expected: no verified claim is any
  // employer's and nothing was invented (no note at all is right too).
  right: boolean | null;
  // [DOMAIN] The wider reading, for a note built on the person's own notes:
  // no verified claim is another employer's, and the note rests on something
  // of theirs (a verified claim of an accepted employer, or a claim that
  // rests on their own notes or plan, or on an accepted employer's fact it
  // did not cite). A note whose only employer is another's is not grounded.
  // With nothing expected: as `right`.
  grounded: boolean | null;
  // Verified claims of an accepted employer AND of another: a second story
  // told beside the right one. Not counted as the wrong employer.
  mixed: boolean;
  // The note is of ANOTHER employer only: by what it verified, or, with
  // nothing verified, by the only employers it names or rests on.
  wrongEmployer: boolean;
  // The note makes claims and none of them is verified or the person's own.
  inferenceOnly: boolean;
};

export function scoreNote(input: {
  note: CoachNote | undefined;
  // The facts the coach was given for the turn the note answers.
  facts: readonly GivenFact[];
  // Every line heard up to that turn's last, and the plan for the call.
  conversation: readonly string[];
  plan?: string | undefined;
  // The facts given for earlier turns of the call (a kept session holds them).
  earlier?: readonly GivenFact[] | undefined;
  expectation: EvidenceExpectation | null;
  employers: readonly string[];
}): NoteScore & { inventedItems: Invented } {
  const { note, facts, expectation, employers } = input;
  const earlier = input.earlier ?? [];
  const evidence = scoreEvidence(note, facts, expectation, employers, {
    plan: input.plan,
    conversation: input.conversation,
    earlier,
  });
  const inventedItems = note
    ? inventedIn(
        noteText(note),
        [
          ...facts.map((fact) => fact.text),
          // A figure of a fact given earlier in the call was given.
          ...earlier.map((fact) => fact.text),
          ...input.conversation,
          ...(input.plan ? [input.plan] : []),
        ],
        employers,
      )
    : { figures: [], employers: [] };
  const invented = {
    figures: inventedItems.figures.length,
    employers: inventedItems.employers.length,
  };
  const right =
    expectation === null
      ? null
      : expectation.kind === "employers"
        ? evidence.accepted > 0 && evidence.wrong === 0
        : evidence.wrong === 0 && invented.figures + invented.employers === 0;
  // [DOMAIN] Whose story the note tells, when an employer is expected. What
  // the verifier marked decides; with nothing verified under a role, what the
  // note rests on and names does.
  const expecting = expectation?.kind === "employers";
  const ofAccepted =
    evidence.accepted + evidence.uncited.accepted + evidence.named.accepted > 0;
  const ofOther =
    evidence.wrong + evidence.uncited.wrong + evidence.named.other > 0;
  const wrongEmployer = expecting
    ? evidence.accepted + evidence.wrong > 0
      ? evidence.wrong > 0 && evidence.accepted === 0
      : ofOther && !ofAccepted
    : // Where the material has nothing, any employer's fact cited is wrong.
      expectation?.kind === "nothing" && evidence.wrong > 0;
  return {
    evidence,
    invented,
    inventedItems,
    right,
    grounded: expecting
      ? !wrongEmployer &&
        (evidence.accepted > 0 ||
          evidence.uncited.accepted > 0 ||
          evidence.own > 0)
      : right,
    mixed: expecting && evidence.accepted > 0 && evidence.wrong > 0,
    wrongEmployer,
    inferenceOnly:
      evidence.inferred > 0 &&
      evidence.own === 0 &&
      evidence.uncited.accepted + evidence.uncited.wrong === 0 &&
      evidence.accepted + evidence.wrong + evidence.other === 0,
  };
}

export type NoteTotals = {
  // Questions with an evidence expectation, and how many notes were right.
  rightEvidence: { right: number; of: number };
  // Of the same questions: notes that rest on something of the person's own
  // (the record, or their own notes) and cite no other employer.
  grounded: { right: number; of: number };
  // Notes, of every question scored, whose claims are all the model's own.
  inferenceOnly: number;
  // Questions with an employer expected: the pack offered one of its facts.
  offered: { right: number; of: number };
  // Questions whose note is of another employer ONLY (see NoteScore), and
  // those that tell a second employer's story beside the right one.
  wrongEmployer: number;
  mixed: number;
  // Figures and employer names invented, over every note scored.
  invented: number;
  // Questions that must be answered, and how many had their note's first
  // line within the threshold.
  inTime: { right: number; of: number };
};

export function totalsOf(
  questions: readonly {
    optional: boolean;
    inTime: boolean | null;
    note: NoteScore | null;
  }[],
): NoteTotals {
  const scored = questions.flatMap((question) =>
    question.note ? [question.note] : [],
  );
  const expected = scored.filter((note) => note.right !== null);
  const asked = questions.filter((question) => !question.optional);
  return {
    rightEvidence: {
      right: expected.filter((note) => note.right === true).length,
      of: expected.length,
    },
    grounded: {
      right: expected.filter((note) => note.grounded === true).length,
      of: expected.length,
    },
    inferenceOnly: scored.filter((note) => note.inferenceOnly).length,
    offered: {
      right: scored.filter((note) => note.evidence.offered === true).length,
      of: scored.filter((note) => note.evidence.offered !== null).length,
    },
    wrongEmployer: expected.filter((note) => note.wrongEmployer).length,
    mixed: expected.filter((note) => note.mixed).length,
    invented: scored.reduce(
      (sum, note) => sum + note.invented.figures + note.invented.employers,
      0,
    ),
    inTime: {
      right: asked.filter((question) => question.inTime === true).length,
      of: asked.length,
    },
  };
}

// The run in one line, the last a replay prints.
export const totalsLine = (totals: NoteTotals): string =>
  `right evidence ${totals.rightEvidence.right} of ${totals.rightEvidence.of}, grounded ${totals.grounded.right} of ${totals.grounded.of}, offered ${totals.offered.right} of ${totals.offered.of}, inference only ${totals.inferenceOnly}, wrong employer ${totals.wrongEmployer}, two employers ${totals.mixed}, invented ${totals.invented}, in time ${totals.inTime.right} of ${totals.inTime.of}`;

// ---- A note written without a model -----------------------------------------

// [DOMAIN] The reply of the scripted note-writer (`--runtime scripted`): a
// stand-in for a model that does one honest thing, so the scoring is run end
// to end with no model. It cites the first fact of a role the coach was
// given; with none, the first fact of the person's own; with nothing of
// theirs, it warns and claims nothing. A look at the candidate's own answer
// or at the screen says nothing, as a coach mostly should.
export function scriptedReply(input: {
  reason: string;
  facts: readonly (GivenFact & { about: string })[];
}): string {
  if (input.reason === "answer-check" || input.reason === "screen-change")
    return "NONE";
  const own = input.facts.filter(
    (fact) => fact.about === "candidate" || fact.about === "preference",
  );
  const fact =
    own.find((each) => /^\/roles\/\d+\/./.test(each.pointer)) ??
    own.find((each) => each.pointer.startsWith("/roles/")) ??
    own[0];
  const head = ["KIND: direct-answer", "SAME: no", "ASK: Scripted note"];
  if (!fact)
    return [
      ...head,
      "CAUTION: The record holds nothing for this: answer from your own experience.",
    ].join("\n");
  // Whole words only, so no figure is cut in half, and none of the marks the
  // reply's own format reads.
  const words = fact.text.replace(/[*[\]]/g, "").split(/\s+/);
  let claim = "";
  for (const word of words) {
    if (`${claim} ${word}`.length > 140) break;
    claim = claim ? `${claim} ${word}` : word;
  }
  return [...head, `SAY: From the record: **${claim}**[${fact.pointer}]`].join(
    "\n",
  );
}
