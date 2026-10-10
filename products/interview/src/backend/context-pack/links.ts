// Links between what a person prepared and what they did, made in code.
//
// PROBLEM: a prep note says "Proof: Copperleaf, 3M+ learners" and the pack
// still offers another employer's evidence, because nothing ties the note to
// the role it names. STRATEGY: after the sources are turned into records, one
// pass reads each story, prep note and requirement and records what it points
// at, by rules a person can check. No model is asked: a link is only made
// where the words themselves make it.
// COMPLEXITY: O(records x roles) for names, O(notes x achievements of the
// named roles) for figures.
//
// [DOMAIN] The three links, strongest first:
//   - `achievements`: an achievement of a named employer whose figure the
//     line states with one of the achievement's own words beside it ("65%
//     fewer vulnerabilities" for "security vulnerabilities: 65%"). The figure
//     alone is not enough: "60% implementation" is not "defects: 60%".
//   - `roles`: an employer the line names. A name is the employer's whole
//     name ("Larchmont Pay"), or its first word where the material only ever
//     writes that word as a name ("Copperleaf" for "Copperleaf Learning").
//   - `technologies`: a technology of the person's own stack that a
//     requirement names ("PostgreSQL" in "Relational modelling in
//     PostgreSQL"). Any achievement done on that technology bears on it.
//     A requirement also takes a `roles` link through the person's notes: when
//     it names a technology of the employer's stack ("NestJS") and a prep note
//     says that technology and names exactly one employer, the requirement is
//     tied to that employer, though the person's record never says the word.
// A requirement keeps the technologies it names in `fields.technologies`, so
// one named there counts as one named by an achievement does (recipe.ts).
// A link is stored as an object under `fields.links`, which selection never
// matches on: it changes which evidence is preferred, never what is found.
import type { GivenLink, JsonValue, Source } from "@omnitech/ai-engine";
import { KINDS, LINKS, sameAs, wordsOf } from "./recipe";

// A record as linking reads it: one a source gives, or one already prepared.
type SourceRecord = Readonly<{
  id: string;
  kind: string;
  text: string;
  fields?: Readonly<Record<string, JsonValue>>;
}>;
export type Links = {
  achievements: string[];
  roles: string[];
  technologies: string[];
  // For a requirement: a technology of the employer's, and the roles the
  // person's notes tie it to.
  through?: { technology: string; roles: string[] }[];
};

// What an achievement is of, as sources.ts wrote it.
export const roleOf = (record: {
  fields?: Readonly<Record<string, unknown>>;
}): string | undefined => {
  const of = record.fields?.["of"];
  return of && typeof of === "object" && !Array.isArray(of)
    ? ((of as { role?: string }).role ?? undefined)
    : undefined;
};
export const linksOf = (record: {
  fields?: Readonly<Record<string, unknown>>;
}): Links | undefined => {
  const links = record.fields?.["links"];
  return links && typeof links === "object" && !Array.isArray(links)
    ? (links as Links)
    : undefined;
};
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((each): each is string => typeof each === "string")
    : [];

// The words of a text as they were written, capitals kept.
const written = (text: string): string[] =>
  text.match(/[A-Za-z0-9][A-Za-z0-9+#.]*/g) ?? [];
// A figure a line states: digits with their unit ("3m+", "65%", "120k"). One
// bare digit ("9") is too little to tie two lines together.
const figureIn = (piece: string) =>
  (piece.toLowerCase().match(/\d[\d.,]*[a-z%+]*/g) ?? [])
    .map((figure) => figure.replace(/[.,]+$/, ""))
    .filter((figure) => figure.length > 1);
// A word without its plural, for this comparison only: "learners" beside a
// figure is the "learner" of "learner accounts".
const bare = (word: string) => word.replace(/s$/, "");
const SMALL = new Set(["a", "an", "and", "the", "of", "to", "for", "in", "on"]);
// Each figure a text states, with the words said in the same clause.
function statedIn(text: string): { figure: string; beside: Set<string> }[] {
  return text.split(/[;,:()]|\.\s/).flatMap((clause) => {
    const figures = figureIn(clause);
    const beside = new Set(
      wordsOf(clause)
        .filter((word) => !/\d/.test(word) && !SMALL.has(word))
        .map(bare),
    );
    return figures.map((figure) => ({ figure, beside }));
  });
}
const NAME_LETTERS = 4;

export function linkSources(sources: readonly Source[]): Source[] {
  const linked = linker(sources.flatMap((source) => source.records ?? []));
  return sources.map((source) => ({
    ...source,
    ...(source.records ? { records: source.records.map(linked) } : {}),
  }));
}

// The same links over records however they were come by: what a source gave
// and what a model extracted are linked by one rule (pack.ts links a prepared
// pack's extracted requirements with it).
export function linkRecords<Each extends SourceRecord>(
  records: readonly Each[],
): Each[] {
  return records.map(linker(records));
}

function linker(
  records: readonly SourceRecord[],
): <Each extends SourceRecord>(record: Each) => Each {
  const roles = records.filter((record) => record.kind === KINDS.role);
  const achievements = records.filter(
    (record) => record.kind === KINDS.achievement,
  );
  if (roles.length === 0) return (record) => record;

  // [DOMAIN] A word the material ever writes in lower case is a word, not a
  // name: "Relay" may name an employer only if nobody wrote "relay".
  const lowered = new Set<string>();
  for (const record of records)
    for (const text of [
      record.text,
      ...Object.values(record.fields ?? {}).flatMap(strings),
    ])
      for (const word of written(text))
        if (word === word.toLowerCase()) lowered.add(word);
  const firsts = new Map<string, number>();
  const first = (company: string) => written(company)[0] ?? "";
  for (const role of roles) {
    const word = first(String(role.fields?.["company"] ?? ""));
    firsts.set(word, (firsts.get(word) ?? 0) + 1);
  }
  const named = (text: string, company: string): boolean => {
    if (company === "") return false;
    const whole = ` ${wordsOf(text).join(" ")} `;
    if (whole.includes(` ${wordsOf(company).join(" ")} `)) return true;
    const word = first(company);
    return (
      word.length >= NAME_LETTERS &&
      word !== word.toLowerCase() &&
      firsts.get(word) === 1 &&
      !lowered.has(word.toLowerCase()) &&
      written(text).includes(word)
    );
  };

  const byRole = new Map<string, SourceRecord[]>();
  for (const achievement of achievements) {
    const role = roleOf(achievement);
    if (role) byRole.set(role, [...(byRole.get(role) ?? []), achievement]);
  }
  // What an achievement states in its own parts (never its period): each
  // figure, and every word of the parts.
  const own = (achievement: SourceRecord) => {
    const parts = achievement.fields?.["parts"];
    const said = (Array.isArray(parts) ? parts : [])
      .map((part) =>
        part && typeof part === "object" && !Array.isArray(part)
          ? String((part as { text?: string }).text ?? "")
          : "",
      )
      .join(" ; ");
    return {
      figures: new Set(figureIn(said)),
      words: new Set(wordsOf(said).map(bare)),
    };
  };
  const says = (said: ReadonlySet<string>, words: readonly string[]) =>
    words.length > 0 &&
    words.every((word) => sameAs(word).some((form) => said.has(form)));
  // The person's own technologies, and the employer's (the brief's stack
  // lines), each as the words that name it.
  const names = (list: readonly string[]) =>
    [...new Set(list)].map((name) => ({ name, words: wordsOf(name) }));
  const stack = names(
    roles.flatMap((role) => strings(role.fields?.["technologies"])),
  );
  // [DOMAIN] A stack line may be a phrase ("NestJS microservices"): the
  // technology in it is the word written as a name, with a capital in it.
  const theirs = names(
    records
      .filter((record) => record.fields?.["section"] === "techStack")
      .flatMap((record) => written(record.text))
      .filter((word) => word !== word.toLowerCase()),
  );

  const noteLinks = (record: SourceRecord): Links => {
    const at = roles
      .filter((role) =>
        named(record.text, String(role.fields?.["company"] ?? "")),
      )
      .map((role) => role.id);
    const stated = statedIn(record.text);
    return {
      roles: at,
      achievements: at
        .flatMap((role) => byRole.get(role) ?? [])
        .filter((achievement) => {
          const { figures, words } = own(achievement);
          return stated.some(
            ({ figure, beside }) =>
              figures.has(figure) &&
              [...beside].some((word) => words.has(word)),
          );
        })
        .map((achievement) => achievement.id),
      technologies: [],
    };
  };
  // [DOMAIN] A technology of the employer's that the person's notes tie to
  // one employer of theirs: the note says the technology and names exactly
  // one employer. Two employers in one note tie it to neither.
  const tied = new Map<string, string[]>();
  for (const note of records) {
    if (note.fields?.["section"] !== "prepNotes") continue;
    const at = noteLinks(note).roles;
    if (at.length !== 1) continue;
    const said = new Set(wordsOf(note.text));
    for (const { name, words } of theirs)
      if (says(said, words))
        tied.set(name, [...new Set([...(tied.get(name) ?? []), ...at])]);
  }

  return <Each extends SourceRecord>(record: Each): Each => {
    if (record.kind === KINDS.story || record.kind === KINDS.prep) {
      const links = noteLinks(record);
      return links.roles.length === 0
        ? record
        : { ...record, fields: { ...record.fields, links } };
    }
    if (record.kind !== KINDS.requirement) return record;
    const said = new Set(wordsOf(record.text));
    const mine = stack.filter(({ words }) => says(said, words));
    const asked = theirs.filter(({ words }) => says(said, words));
    // One technology under two accepted names ("PostgreSQL", "Postgres") is
    // kept once, by the person's own name for it.
    const same = (a: readonly string[], b: readonly string[]) =>
      a.length === b.length &&
      a.every((word, at) => sameAs(word).includes(b[at] ?? ""));
    const technologies = [
      ...new Set(
        [
          ...mine,
          ...asked.filter(
            ({ words }) => !mine.some((own) => same(words, own.words)),
          ),
        ].map(({ name }) => name),
      ),
    ];
    if (technologies.length === 0) return record;
    const through = asked.flatMap(({ name }) => {
      const at = tied.get(name) ?? [];
      return at.length > 0 ? [{ technology: name, roles: at }] : [];
    });
    const links: Links = {
      achievements: [],
      roles: [],
      technologies: mine.map(({ name }) => name),
      through,
    };
    return {
      ...record,
      fields: {
        ...record.fields,
        technologies,
        ...(through.length + links.technologies.length > 0 ? { links } : {}),
      },
    };
  };
}

// [STRATEGY] The links above as the ties the engine keeps (recipe.ts, LINKS):
// each from the record that names something to an ACHIEVEMENT it stands for.
// An employer named is every achievement of that role; a technology is every
// achievement done on it. The engine checks each tie again (both ends exist,
// the pair is one the step allows) and a slot of evidence follows them, so a
// selected note keeps what it names in the ranking with no second search.
export function givenLinks(records: readonly SourceRecord[]): GivenLink[] {
  const ofRole = new Map<string, string[]>();
  const onTechnology = new Map<string, string[]>();
  const put = (into: Map<string, string[]>, key: string, id: string) =>
    into.set(key, [...(into.get(key) ?? []), id]);
  for (const record of records) {
    if (record.kind !== KINDS.achievement) continue;
    const role = roleOf(record);
    if (role) put(ofRole, role, record.id);
    for (const technology of strings(record.fields?.["stack"]))
      put(onTechnology, technology.toLowerCase(), record.id);
  }
  const given = new Map<string, GivenLink>();
  const tie = (
    step: string,
    from: string,
    to: readonly string[],
    fields: NonNullable<GivenLink["fields"]>,
  ) => {
    // The first tie between two records stands: the strongest is made first.
    for (const id of to)
      if (!given.has(`${step}\n${from}\n${id}`))
        given.set(`${step}\n${from}\n${id}`, { step, from, to: id, fields });
  };
  for (const record of records) {
    const links = linksOf(record);
    if (!links) continue;
    if (record.kind === KINDS.prep || record.kind === KINDS.story) {
      const step = record.kind === KINDS.prep ? LINKS.names : LINKS.tells;
      tie(step, record.id, links.achievements, { basis: "figure" });
      tie(
        step,
        record.id,
        links.roles.flatMap((role) => ofRole.get(role) ?? []),
        { basis: "employer" },
      );
    } else if (record.kind === KINDS.requirement) {
      for (const each of links.through ?? [])
        tie(
          LINKS.stack,
          record.id,
          each.roles.flatMap((role) => ofRole.get(role) ?? []),
          { technology: each.technology, via: "note" },
        );
      for (const technology of links.technologies)
        tie(
          LINKS.stack,
          record.id,
          onTechnology.get(technology.toLowerCase()) ?? [],
          { technology, via: "own" },
        );
    }
  }
  return [...given.values()];
}
