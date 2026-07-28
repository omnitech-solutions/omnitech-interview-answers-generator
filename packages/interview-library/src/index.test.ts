import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  libraryItemInputSchema,
  type LibraryItem,
  type LibrarySearchQuery,
} from "@omnitech/interview-contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  extractLibrarySections,
  interviewLibrarySeed,
  OramaLibrarySearchIndex,
} from "./index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("Library section extraction", () => {
  it("creates stable duplicate anchors and heading breadcrumbs", () => {
    expect(
      extractLibrarySections(
        "Intro\n\n# State\nFirst\n\n## Ownership\nSecond\n\n## Ownership\nThird",
      ),
    ).toEqual([
      { anchor: "", headingPath: [], body: "Intro" },
      { anchor: "state", headingPath: ["State"], body: "First" },
      {
        anchor: "ownership",
        headingPath: ["State", "Ownership"],
        body: "Second",
      },
      {
        anchor: "ownership-1",
        headingPath: ["State", "Ownership"],
        body: "Third",
      },
    ]);
  });

  it("indexes heading-only and heading-free documents", () => {
    expect(extractLibrarySections("Plain body")).toEqual([
      { anchor: "", headingPath: [], body: "Plain body" },
    ]);
    expect(extractLibrarySections("# Only heading")).toEqual([
      { anchor: "only-heading", headingPath: ["Only heading"], body: "" },
    ]);
  });
});

describe("OramaLibrarySearchIndex", () => {
  it("ranks exact titles and returns section anchors and safe excerpts", async () => {
    const index = new OramaLibrarySearchIndex();
    await index.rebuild(
      [
        item({
          title: "React state",
          slug: "react-state",
          body: "# Ownership\n\nState belongs to one owner.",
        }),
        item({
          title: "Rendering guide",
          slug: "rendering-guide",
          body: "# Details\n\nThis body mentions React state later.",
        }),
      ],
      3,
    );

    const response = await index.search(query({ query: "React state" }));
    expect(response.hits[0]).toMatchObject({
      title: "React state",
      anchor: "ownership",
      headingPath: ["Ownership"],
    });
    expect(response.hits[0]?.excerpt).not.toContain("<");
    expect(response.total).toBeGreaterThan(0);
    expect(response.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("composes content, collection, tag, and official filters", async () => {
    const index = new OramaLibrarySearchIndex();
    await index.rebuild(
      [
        item({
          contentType: "official-reference",
          source: {
            publisher: "React",
            canonicalUrl: "https://react.dev",
            official: true,
            lastVerifiedAt: "2026-07-27",
          },
        }),
        item({
          slug: "studio-react",
          title: "Studio React",
          contentType: "cheat-sheet",
        }),
        item({
          slug: "backend-cache",
          title: "Backend cache",
          collection: "backend",
          tags: ["backend", "cache"],
        }),
      ],
      4,
    );

    const official = await index.search(
      query({
        query: "React",
        contentTypes: ["official-reference"],
        collections: ["react"],
        tags: ["react"],
        officialOnly: true,
      }),
    );
    expect(official.hits).toHaveLength(1);
    expect(official.hits[0]).toMatchObject({
      official: true,
      publisher: "React",
      canonicalUrl: "https://react.dev",
    });
    expect(official.facets.contentTypes).toBeDefined();
  });

  it("persists, restores only matching revisions, and rejects corruption", async () => {
    const directory = await mkdtemp(join(tmpdir(), "library-index-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "library.msp");
    const original = new OramaLibrarySearchIndex();
    await original.rebuild([item({})], 9);
    await original.persist(path);

    const restored = new OramaLibrarySearchIndex();
    expect(await restored.restore(path, 8)).toBe(false);
    expect(await restored.restore(path, 9)).toBe(true);
    expect(restored.sourceRevision()).toBe(9);
    expect(
      (await restored.search(query({ query: "React" }))).hits,
    ).toHaveLength(1);

    await writeFile(`${path}.revision.json`, "{corrupt");
    expect(await new OramaLibrarySearchIndex().restore(path, 9)).toBe(false);
  });

  it("finds core React APIs by their exact public names", async () => {
    const index = new OramaLibrarySearchIndex();
    const timestamps = "2026-07-27T00:00:00.000Z";
    await index.rebuild(
      interviewLibrarySeed.map((entry, seedIndex) => ({
        ...entry,
        id: `seed-${seedIndex}`,
        status: "published" as const,
        createdAt: timestamps,
        updatedAt: timestamps,
        publishedAt: timestamps,
        revision: 1,
      })),
      1,
    );

    for (const apiName of [
      "useRef",
      "useState",
      "useEffect",
      "useReducer",
      "useContext",
      "useMemo",
      "useCallback",
      "useTransition",
      "useSyncExternalStore",
    ]) {
      const response = await index.search(
        query({ query: apiName, collections: ["react"] }),
      );
      expect(response.hits[0]?.title).toBe(apiName);
    }
  });

  it("handles empty indexes, pagination, short terms, and seed composition", async () => {
    expect(() =>
      interviewLibrarySeed.forEach((entry) =>
        libraryItemInputSchema.parse(entry),
      ),
    ).not.toThrow();
    expect(interviewLibrarySeed).toHaveLength(54);
    expect(
      interviewLibrarySeed.filter((entry) => entry.collection === "react"),
    ).toHaveLength(32);
    expect(
      interviewLibrarySeed.filter((entry) => entry.collection === "web"),
    ).toHaveLength(7);
    expect(
      interviewLibrarySeed.filter((entry) => entry.collection === "backend"),
    ).toHaveLength(7);
    expect(
      interviewLibrarySeed.filter((entry) => entry.collection === "dsa"),
    ).toHaveLength(8);

    const index = new OramaLibrarySearchIndex();
    await index.rebuild([], 0);
    expect((await index.search(query({ query: "Map" }))).hits).toEqual([]);
    expect(index.sourceRevision()).toBe(0);
  });
});

function query(overrides: Partial<LibrarySearchQuery>): LibrarySearchQuery {
  return {
    query: "",
    contentTypes: [],
    collections: [],
    tags: [],
    officialOnly: false,
    offset: 0,
    limit: 20,
    ...overrides,
  };
}

function item(overrides: Partial<LibraryItem>): LibraryItem {
  return {
    id: crypto.randomUUID(),
    slug: "react-guide",
    title: "React guide",
    summary: "A focused React reference.",
    body: "# React\n\nUse one source of truth.",
    contentType: "concept-guide",
    collection: "react",
    tags: ["react", "state"],
    status: "published",
    createdAt: "2026-07-27T00:00:00.000Z",
    updatedAt: "2026-07-27T00:00:00.000Z",
    publishedAt: "2026-07-27T00:00:00.000Z",
    revision: 1,
    ...overrides,
  };
}
