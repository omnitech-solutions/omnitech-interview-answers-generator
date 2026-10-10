import type {
  LibraryItem,
  LibrarySearchQuery,
  LibrarySearchResponse,
} from "@omnitech/interview-contracts";
import { create, insertMultiple, search } from "@orama/orama";
import {
  persistToFile,
  restoreFromFile,
} from "@orama/plugin-data-persistence/server";
import {
  buildWhere,
  facetsFrom,
  retriesWithTolerance,
  SEARCH_BOOST,
  SEARCH_FACETS,
  SEARCH_PROPERTIES,
  searchableTechnicalTerm,
  toHit,
} from "./library-ranking";
import { type LibrarySection, toSearchSections } from "./library-sections";

export { interviewLibrarySeed } from "./catalog";
export {
  extractLibrarySections,
  type LibrarySectionDraft,
} from "./library-sections";

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

export interface LibrarySearchIndex {
  persist(filePath: string): Promise<void>;
  rebuild(items: LibraryItem[], revision: number): Promise<void>;
  restore(filePath: string, revision: number): Promise<boolean>;
  search(query: LibrarySearchQuery): Promise<LibrarySearchResponse>;
  sourceRevision(): number;
}

// The Orama index of the library: building, keeping on disk and querying.
// What a section is lives in ./library-sections; what a search admits and how
// a hit ranks lives in ./library-ranking.
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
    const run = (tolerance: number) =>
      search(this.database, {
        mode: "fulltext",
        term: searchTerm,
        properties: SEARCH_PROPERTIES,
        boost: SEARCH_BOOST,
        tolerance,
        ...(where ? { where } : {}),
        facets: SEARCH_FACETS,
        offset: query.offset,
        limit: query.limit,
      });
    const exact = await run(0);
    const result = retriesWithTolerance(exact.count, searchTerm)
      ? await run(1)
      : exact;
    const hits = result.hits.map(({ document, score }) =>
      toHit(document as unknown as LibrarySection, score, query.query),
    );
    hits.sort((left, right) => right.score - left.score);
    return {
      hits,
      total: result.count,
      elapsedMs: performance.now() - startedAt,
      facets: facetsFrom(result.facets),
    };
  }
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
