// The decisions of a library search, as pure functions and data: which fields
// are searched and how much each counts, which sections a query admits, when
// typo tolerance applies, and how a stored section becomes a ranked hit.
import type {
  LibraryFacets,
  LibrarySearchQuery,
  LibrarySearchResponse,
} from "@omnitech/interview-contracts";
import {
  headingPathOf,
  type LibrarySection,
  plainText,
} from "./library-sections";

// The searched fields and the weight of a match in each, strongest first.
export const SEARCH_BOOST = {
  title: 8,
  heading: 6,
  tagsText: 4,
  summary: 3,
  publisher: 2,
  body: 1,
} as const;

export const SEARCH_PROPERTIES = Object.keys(SEARCH_BOOST) as Array<
  keyof typeof SEARCH_BOOST
>;

export const SEARCH_FACETS = {
  contentType: { limit: 20 },
  collection: { limit: 50 },
  tags: { limit: 100 },
} as const;

export function searchableTechnicalTerm(value: string): string {
  return value
    .replace(/[_\\:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// [STRATEGY] Exact before fuzzy: typo tolerance treats "nextjs" and "nestjs"
// as the same word, and the fuzzy title matches then crowd the exact ones off
// the first page. Tolerance is used only when the exact term finds nothing
// (a real typo), and never for a term too short to misspell usefully.
export const retriesWithTolerance = (
  exactCount: number,
  searchTerm: string,
): boolean => exactCount === 0 && searchTerm.length >= 5;

export function buildWhere(query: LibrarySearchQuery) {
  const conditions: Array<Record<string, unknown>> = [];
  if (!query.query) conditions.push({ primary: true });
  if (query.contentTypes.length > 0) {
    conditions.push({ contentType: { in: query.contentTypes } });
  }
  if (query.collections.length > 0) {
    conditions.push({ collection: { in: query.collections } });
  }
  if (query.tags.length > 0) {
    conditions.push({ tags: { containsAll: query.tags } });
  }
  if (query.officialOnly) conditions.push({ official: true });
  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : { and: conditions };
}

export function facetsFrom(
  facets:
    | Record<string, { count: number; values: Record<string, number> }>
    | undefined,
): LibraryFacets {
  return {
    contentTypes: facets?.["contentType"]?.values ?? {},
    collections: facets?.["collection"]?.values ?? {},
    tags: facets?.["tags"]?.values ?? {},
  };
}

function excerpt(body: string, query: string): string {
  const clean = plainText(body).replace(/\s+/g, " ").trim();
  if (!query.trim()) return clean.slice(0, 220);
  const index = clean.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, index < 0 ? 0 : index - 80);
  return `${start > 0 ? "…" : ""}${clean.slice(start, start + 220)}${
    start + 220 < clean.length ? "…" : ""
  }`;
}

type LibrarySearchHit = LibrarySearchResponse["hits"][number];

// A stored section as the hit the caller sees, ranked. A title that IS the
// query comes first. [STRATEGY] A query that IS a technology's tag ("nextjs")
// ranks that technology's articles next: typo tolerance treats near spellings
// as matches, so without this "nextjs" surfaces NestJS ahead of Next.js.
export function toHit(
  section: LibrarySection,
  score: number,
  query: string,
): LibrarySearchHit {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const exactTitle =
    normalizedQuery && section.title.toLocaleLowerCase() === normalizedQuery
      ? 100
      : 0;
  const exactTag =
    normalizedQuery !== "" &&
    (section.collection === normalizedQuery ||
      section.tags.includes(normalizedQuery))
      ? 50
      : 0;
  return {
    itemId: section.itemId,
    slug: section.slug,
    title: section.title,
    summary: section.summary,
    contentType: section.contentType,
    collection: section.collection,
    tags: section.tags,
    official: section.official,
    ...(section.publisher ? { publisher: section.publisher } : {}),
    ...(section.canonicalUrl ? { canonicalUrl: section.canonicalUrl } : {}),
    anchor: section.anchor,
    headingPath: headingPathOf(section),
    excerpt: excerpt(section.body, query),
    score: score + exactTitle + exactTag,
  };
}
