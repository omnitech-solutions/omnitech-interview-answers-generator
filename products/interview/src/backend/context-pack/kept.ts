// A pack a model prepared, read with today's material.
//
// PROBLEM: a model prepares an application's pack once (prepare.ts) and the
// engine keeps it; every reader (the live coach, a briefing, a document, the
// view a person inspects) must use what it extracted WITHOUT a model on its
// own path, and must never read a fact whose source has changed since.
// STRATEGY: a reader prepares today's material in code, as it always did,
// and this file adds to it what the kept pack holds that still stands: the
// records a model extracted from a source that is at the same revision now,
// the ties whose two ends are both still there, and what the person did in
// the review. Nothing here asks a model, and with no kept pack nothing here
// runs: the reader has exactly what it had before.
// COMPLEXITY: O(records + links), once per pack.
import type { ContextLink, ContextRecord, Prepared } from "@omnitech/ai-engine";
import { givenLinks, linkRecords } from "./links";
import { KINDS } from "./recipe";

// The source of an application's posting (brief-sources.ts).
export const POSTING_SOURCE = "posting:";
// [DOMAIN] The employer brief's sections that are the posting, cleaned by a
// model with no pointer back to it. When the posting itself has been read,
// each of its lines quoted, the same thing is not offered twice: the quoted
// record stands and the brief's line is left out. What the brief distilled
// from the person's NOTES (prep notes, questions to ask) is not the
// posting's and stays.
export const FROM_THE_POSTING: readonly string[] = [
  "mustHaves",
  "niceToHaves",
  "techStack",
  "responsibilities",
  "companyFacts",
  "values",
  "summary",
  "team",
  "interviewFormat",
];
// A raw line of these sections is left out when a model's record quotes it.
const RAW_LINES: readonly string[] = ["research", "employerSaid"];

// Text as a quote is compared: without case, with every run of space one.
const plain = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();
export const sectionOf = (record: {
  fields?: Readonly<Record<string, unknown>> | undefined;
}): string =>
  typeof record.fields?.["section"] === "string"
    ? (record.fields["section"] as string)
    : "";
const section = sectionOf;

// What of a kept pack still stands beside the material as it is now.
export function standing(
  now: Pick<Prepared, "sources" | "recipe">,
  kept: Prepared,
): { records: ContextRecord[]; current: Set<string> } {
  // [GUARD] A pack of another recipe version was extracted by other
  // instructions into other kinds: none of it is read.
  if (
    kept.recipe.id !== now.recipe.id ||
    kept.recipe.version !== now.recipe.version
  )
    return { records: [], current: new Set() };
  const revision = new Map(
    now.sources.map(({ id, revision }) => [id, revision]),
  );
  // [SAFETY] A record a model extracted stands only while its source says
  // what it said: the same source at the same revision.
  const current = new Set(
    kept.sources
      .filter(({ id, revision: at }) => revision.get(id) === at)
      .map(({ id }) => id),
  );
  return {
    records: kept.records.filter(
      (record) => record.by === "model" && current.has(record.source.id),
    ),
    current,
  };
}

export function withKept(fresh: Prepared, kept: Prepared): Prepared {
  const { records: extracted } = standing(fresh, kept);
  const removed = new Set(kept.removed ?? []);
  const reviewed = new Map(
    kept.records
      .filter((record) => record.reviewed && record.by !== "model")
      .map((record) => [record.id, record]),
  );
  // [DOMAIN] What a model wrote ABOUT a record the person gave (the words it
  // would be searched by and the questions it answers: the recipe's
  // annotators) is kept beside the record and apart from what it says. It is
  // carried onto today's record only while the record says what it said when
  // the terms were written (`for` is the record's hash, and the engine
  // matches no terms written for another), and only from a pack of this
  // recipe version.
  const sameRecipe =
    kept.recipe.id === fresh.recipe.id &&
    kept.recipe.version === fresh.recipe.version;
  const annotated = new Map(
    sameRecipe
      ? kept.records.flatMap((record) =>
          record.terms && record.by !== "model"
            ? [[record.id, record.terms] as const]
            : [],
        )
      : [],
  );
  if (
    extracted.length === 0 &&
    removed.size === 0 &&
    reviewed.size === 0 &&
    annotated.size === 0
  )
    return fresh;

  const postingRead = extracted.some((record) =>
    record.source.id.startsWith(POSTING_SOURCE),
  );
  // The words each source's extracted records rest on.
  const quoted = new Map<string, string[]>();
  for (const record of extracted) {
    const quotes = [
      record.source.quote,
      ...(record.source.also ?? []).map((each) => each.quote),
    ].flatMap((quote) => (quote ? [plain(quote)] : []));
    quoted.set(record.source.id, [
      ...(quoted.get(record.source.id) ?? []),
      ...quotes,
    ]);
  }
  const superseded = (record: ContextRecord) => {
    if (record.source.id.startsWith("brief:"))
      return postingRead && FROM_THE_POSTING.includes(section(record));
    if (!RAW_LINES.includes(section(record))) return false;
    const line = plain(record.text);
    return (quoted.get(record.source.id) ?? []).some(
      (quote) => line.includes(quote) || quote.includes(line),
    );
  };

  // [DOMAIN] What the person did in the review outlives a preparation, and so
  // it holds for a reader too: a record they removed is not read, one they
  // changed says what they wrote.
  const own = fresh.records
    .filter((record) => !removed.has(record.id) && !superseded(record))
    .map((record) => {
      const terms = annotated.get(record.id);
      return terms && terms.for === record.hash ? { ...record, terms } : record;
    })
    .map((record) => {
      const seen = reviewed.get(record.id);
      if (!seen) return record;
      return seen.reviewed === "edited"
        ? {
            ...record,
            text: seen.text,
            ...(seen.themes ? { themes: seen.themes } : {}),
            ...(seen.answers ? { answers: seen.answers } : {}),
            reviewed: "edited" as const,
          }
        : { ...record, reviewed: "confirmed" as const };
    });
  // An extracted requirement is linked to the person's technologies by the
  // rule every requirement is (links.ts), with everything now in the pack.
  const all = [
    ...own,
    ...extracted.filter((record) => !removed.has(record.id)),
  ];
  const relinked = linkRecords(all);
  const records = all.map((record, at) =>
    record.by === "model" && record.kind === KINDS.requirement
      ? (relinked[at] as ContextRecord)
      : record,
  );

  const ids = new Set(records.map((record) => record.id));
  const made = new Set((fresh.links ?? []).map((link) => link.id));
  const links: ContextLink[] = [...(fresh.links ?? [])].filter(
    (link) => ids.has(link.from) && ids.has(link.to),
  );
  // A model's ties, where both ends still stand.
  for (const link of kept.links ?? [])
    if (
      link.by === "model" &&
      ids.has(link.from) &&
      ids.has(link.to) &&
      !made.has(link.id)
    ) {
      made.add(link.id);
      links.push(link);
    }
  // The ties code makes from an extracted requirement.
  const model = new Set(
    records
      .filter((record) => record.by === "model")
      .map((record) => record.id),
  );
  for (const given of givenLinks(records)) {
    if (!model.has(given.from)) continue;
    const id = `link:code:${given.step}:${given.from}:${given.to}`;
    if (made.has(id)) continue;
    made.add(id);
    links.push({
      id,
      step: given.step,
      from: given.from,
      to: given.to,
      ...(given.fields ? { fields: given.fields } : {}),
      by: "code",
      verified: "ends-exist",
    });
  }
  const here = (sourceId: string) =>
    fresh.sources.some(({ id }) => id === sourceId);
  return {
    ...fresh,
    records,
    links,
    rejected: [
      ...fresh.rejected,
      ...kept.rejected.filter((each) => here(each.sourceId)),
    ],
    holes: (kept.holes ?? []).filter((hole) => here(hole.sourceId)),
    ...(removed.size > 0 ? { removed: [...removed] } : {}),
  };
}
