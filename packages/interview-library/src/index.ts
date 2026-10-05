import type {
  LibraryFacets,
  LibraryItem,
  LibrarySearchQuery,
  LibrarySearchResponse,
} from "@omnitech/interview-contracts";
import { create, insertMultiple, search } from "@orama/orama";
import {
  persistToFile,
  restoreFromFile,
} from "@orama/plugin-data-persistence/server";
import GithubSlugger from "github-slugger";

export { interviewLibrarySeed } from "./catalog";

const indexFormatVersion = 3;

const librarySectionSchema = {
  itemId: "string",
  slug: "string",
  title: "string",
  summary: "string",
  body: "string",
  heading: "string",
  headingPath: "string",
  anchor: "string",
  contentType: "enum",
  collection: "enum",
  tags: "enum[]",
  tagsText: "string",
  official: "boolean",
  primary: "boolean",
  publisher: "string",
  canonicalUrl: "string",
} as const;

type LibraryDatabase = ReturnType<typeof create<typeof librarySectionSchema>>;

interface LibrarySection {
  itemId: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  heading: string;
  headingPath: string;
  anchor: string;
  contentType: LibraryItem["contentType"];
  collection: string;
  tags: string[];
  tagsText: string;
  official: boolean;
  primary: boolean;
  publisher: string;
  canonicalUrl: string;
}

export interface LibrarySearchIndex {
  persist(filePath: string): Promise<void>;
  rebuild(items: LibraryItem[], revision: number): Promise<void>;
  restore(filePath: string, revision: number): Promise<boolean>;
  search(query: LibrarySearchQuery): Promise<LibrarySearchResponse>;
  sourceRevision(): number;
}

export interface LibrarySectionDraft {
  anchor: string;
  body: string;
  headingPath: string[];
}

export class OramaLibrarySearchIndex implements LibrarySearchIndex {
  private database: LibraryDatabase = create({ schema: librarySectionSchema });
  private revision = -1;

  sourceRevision(): number {
    return this.revision;
  }

  async rebuild(items: LibraryItem[], revision: number): Promise<void> {
    const database = create({ schema: librarySectionSchema });
    const sections = items.flatMap(toSearchSections);
    if (sections.length > 0) insertMultiple(database, sections);
    this.database = database;
    this.revision = revision;
  }

  async persist(filePath: string): Promise<void> {
    await persistToFile(this.database, "binary", filePath);
    await persistToFile(
      createRevisionDatabase(this.revision),
      "json",
      `${filePath}.revision.json`,
    );
  }

  async restore(filePath: string, revision: number): Promise<boolean> {
    try {
      const revisionDatabase = await restoreFromFile<LibraryDatabase>(
        "json",
        `${filePath}.revision.json`,
      );
      const revisionResult = await search(revisionDatabase, {
        mode: "fulltext",
        term: "",
        limit: 1,
      });
      const persistedRevision = Number(
        String(revisionResult.hits[0]?.document["body"] ?? "").split(":")[0],
      );
      const persistedFormat = Number(
        String(revisionResult.hits[0]?.document["body"] ?? "").split(":")[1],
      );
      if (
        persistedRevision !== revision ||
        persistedFormat !== indexFormatVersion
      ) {
        return false;
      }
      this.database = await restoreFromFile<LibraryDatabase>(
        "binary",
        filePath,
      );
      this.revision = revision;
      return true;
    } catch {
      return false;
    }
  }

  async search(query: LibrarySearchQuery): Promise<LibrarySearchResponse> {
    const startedAt = performance.now();
    const where = buildWhere(query);
    const searchTerm = searchableTechnicalTerm(query.query);
    const result = await search(this.database, {
      mode: "fulltext",
      term: searchTerm,
      properties: [
        "title",
        "heading",
        "tagsText",
        "summary",
        "publisher",
        "body",
      ],
      boost: {
        title: 8,
        heading: 6,
        tagsText: 4,
        summary: 3,
        publisher: 2,
        body: 1,
      },
      tolerance: searchTerm.length >= 5 ? 1 : 0,
      ...(where ? { where } : {}),
      facets: {
        contentType: { limit: 20 },
        collection: { limit: 50 },
        tags: { limit: 100 },
      },
      offset: query.offset,
      limit: query.limit,
    });
    const normalizedQuery = query.query.trim().toLocaleLowerCase();
    const hits = result.hits.map(({ document, score }) => {
      const section = document as unknown as LibrarySection;
      const exactTitle =
        normalizedQuery && section.title.toLocaleLowerCase() === normalizedQuery
          ? 100
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
        headingPath: section.headingPath
          .split("\u001f")
          .filter((value) => value.length > 0),
        excerpt: excerpt(section.body, query.query),
        score: score + exactTitle,
      };
    });
    hits.sort((left, right) => right.score - left.score);
    return {
      hits,
      total: result.count,
      elapsedMs: performance.now() - startedAt,
      facets: facetsFrom(result.facets),
    };
  }
}

function searchableTechnicalTerm(value: string): string {
  return value
    .replace(/[_\\:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractLibrarySections(
  markdown: string,
): LibrarySectionDraft[] {
  const slugger = new GithubSlugger();
  const headings: string[] = [];
  const sections: LibrarySectionDraft[] = [];
  let current: LibrarySectionDraft = {
    anchor: "",
    headingPath: [],
    body: "",
  };

  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) {
      current.body += `${line}\n`;
      continue;
    }
    if (current.body.trim() || current.headingPath.length > 0) {
      sections.push({ ...current, body: current.body.trim() });
    }
    const level = match[1]?.length ?? 1;
    const heading = plainText(match[2] ?? "");
    headings.splice(level - 1);
    headings[level - 1] = heading;
    current = {
      anchor: slugger.slug(heading),
      headingPath: headings.filter(Boolean),
      body: "",
    };
  }
  if (current.body.trim() || current.headingPath.length > 0) {
    sections.push({ ...current, body: current.body.trim() });
  }
  return sections.length > 0
    ? sections
    : [{ anchor: "", headingPath: [], body: markdown.trim() }];
}

function toSearchSections(item: LibraryItem): LibrarySection[] {
  return extractLibrarySections(item.body).map((section, index) => ({
    itemId: item.id,
    slug: item.slug,
    title: item.title,
    summary: item.summary,
    body: plainText(section.body),
    heading: section.headingPath.at(-1) ?? item.title,
    headingPath: section.headingPath.join("\u001f"),
    anchor: section.anchor,
    contentType: item.contentType,
    collection: item.collection,
    tags: item.tags,
    tagsText: item.tags.join(" "),
    official: item.source?.official ?? false,
    primary: index === 0,
    publisher: item.source?.publisher ?? "",
    canonicalUrl: item.source?.canonicalUrl ?? "",
  }));
}

function buildWhere(query: LibrarySearchQuery) {
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

function facetsFrom(
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

function plainText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " code example ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/[*_~>#-]/g, " ")
    .trim();
}

function createRevisionDatabase(revision: number): LibraryDatabase {
  const database = create({ schema: librarySectionSchema });
  insertMultiple(database, [
    {
      itemId: "revision",
      slug: "revision",
      title: "revision",
      summary: "",
      body: `${revision}:${indexFormatVersion}`,
      heading: "",
      headingPath: "",
      anchor: "",
      contentType: "cheat-sheet",
      collection: "internal",
      tags: ["internal"],
      tagsText: "internal",
      official: false,
      primary: true,
      publisher: "",
      canonicalUrl: "",
    },
  ]);
  return database;
}
