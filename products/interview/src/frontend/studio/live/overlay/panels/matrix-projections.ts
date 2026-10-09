// The experience matrix, read the ways it is used. Each projection here is the
// same matrix from one consumer's side, so the person can see what their
// material turns into and where it could be put to better use. Pure: nothing
// here fetches or changes anything.
import type { CandidateMatrix, CoachNote } from "@omnitech/interview-contracts";

type Role = CandidateMatrix["roles"][number];

// [DOMAIN] A fact is one piece of text in the matrix with its own address
// (the pointer the session context gives the model: "/roles/3/proof_points/1").
// Every string or number in a role is one: the model is handed whole facts,
// never part of one, so how the matrix is cut into facts is how it can be
// quoted.
export type Fact = { pointer: string; text: string };

function walk(value: unknown, pointer: string, into: Fact[]): void {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    if (text !== "") into.push({ pointer, text });
    return;
  }
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries())
      walk(item, `${pointer}/${index}`, into);
    return;
  }
  if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value))
      walk(item, `${pointer}/${key}`, into);
}

export function roleFacts(role: Role, index: number): Fact[] {
  const facts: Fact[] = [];
  walk(role, `/roles/${index}`, facts);
  return facts;
}

// What a fact is, from its address: "proof_points", "metrics", "technologies".
export const factField = (pointer: string): string =>
  pointer.split("/")[3] ?? "";

// The roles a note leans on: those its evidence points at, and those whose
// company it names.
export function rolesLeanedOn(
  notes: readonly CoachNote[],
  matrix: CandidateMatrix,
): Set<string> {
  const leaned = new Set<string>();
  const evidence = notes.flatMap((note) =>
    note.sections.flatMap((section) =>
      section.lines.flatMap((line) =>
        line.segments.filter((segment) => segment.role === "evidence"),
      ),
    ),
  );
  for (const segment of evidence) {
    const pointed = /^\/roles\/\d+/.exec(segment.source ?? "")?.[0];
    if (pointed) leaned.add(pointed);
    const said = segment.text.trim().toLowerCase();
    matrix.roles.forEach((role, index) => {
      // "Relay" names "Relay Platform"; a short word names nothing.
      const company = role.company.toLowerCase();
      if (said.length >= 4 && company.split(/\W+/).includes(said))
        leaned.add(`/roles/${index}`);
    });
  }
  return leaned;
}

// [DOMAIN] The projections on offer, as data: what each is called and what it
// says about how the matrix is consumed. The pane draws whichever is chosen.
export const PROJECTIONS = [
  {
    id: "ranked",
    label: "Ranked roles",
    how: "The order your roles are tried in. Here they are ranked against the job posting; for a live question the same roles are ranked against the question and the brief lines it touches, and a company named in the question jumps to the front.",
  },
  {
    id: "facts",
    label: "Facts the model can quote",
    how: "Every piece of text in a role is one source with its own address. The model is given whole facts, never part of one, the best roles' first, up to 40 for a question. A fact over 400 characters is left out entirely.",
  },
  {
    id: "stories",
    label: "Stories by need",
    how: "Which story answers which kind of question. A role whose story matches what was asked is ranked higher.",
  },
  {
    id: "technology",
    label: "By technology",
    how: "Which roles to reach for when a question names a technology. A role's technologies count as a skill match, the strongest signal in the ranking.",
  },
  {
    id: "industry",
    label: "By industry",
    how: "Which roles fit an industry. A role's industry counts as a domain match, the second signal in the ranking.",
  },
  {
    // Drawn from the server's own selection (the context pack), not worked
    // out here: it is what the coach was given, not an estimate of it.
    id: "selected",
    label: "Selected for this question",
    how: "Exactly what the coach is given for the question on show, chosen on the server from your matrix, the brief and your preferences, and what was left out and why. A fact marked yours can be stated as your experience; the employer's lines only aim the answer.",
  },
] as const;
export type ProjectionId = (typeof PROJECTIONS)[number]["id"];

// The fields of a role a person edits here, as lists of lines.
export const EDITABLE_FIELDS = [
  { key: "proof_points", label: "Proof" },
  { key: "leadership_signals", label: "Leadership" },
  { key: "technologies", label: "Stack" },
] as const;
export type EditableKey = (typeof EDITABLE_FIELDS)[number]["key"];
export type RoleDraft = Record<EditableKey, string>;

export const draftOf = (role: Role): RoleDraft => ({
  proof_points: (role.proof_points ?? []).join("\n"),
  leadership_signals: (role.leadership_signals ?? []).join("\n"),
  technologies: (role.technologies ?? []).join("\n"),
});

// The matrix with one role's lists replaced by the draft's lines (a line per
// item, blank lines dropped). Nothing else in the matrix is touched.
export function withRoleDraft(
  matrix: CandidateMatrix,
  index: number,
  draft: RoleDraft,
): CandidateMatrix {
  const lines = (text: string) =>
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "");
  return {
    ...matrix,
    roles: matrix.roles.map((role, at) =>
      at === index
        ? {
            ...role,
            proof_points: lines(draft.proof_points),
            leadership_signals: lines(draft.leadership_signals),
            technologies: lines(draft.technologies),
          }
        : role,
    ),
  };
}
