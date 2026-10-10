import type { LibrarySearchQuery } from "@omnitech/interview-contracts";
import { expect, it } from "vitest";
import {
  buildWhere,
  retriesWithTolerance,
  SEARCH_PROPERTIES,
  searchableTechnicalTerm,
  toHit,
} from "./library-ranking";
import type { LibrarySection } from "./library-sections";

const query = (overrides: Partial<LibrarySearchQuery> = {}) =>
  ({
    query: "",
    contentTypes: [],
    collections: [],
    tags: [],
    officialOnly: false,
    offset: 0,
    limit: 20,
    ...overrides,
  }) as LibrarySearchQuery;

const section: LibrarySection = {
  itemId: "item-1",
  slug: "nextjs-routing",
  title: "NextJS",
  summary: "Routing.",
  body: `${"a".repeat(100)} the app router handles layouts ${"b".repeat(300)}`,
  heading: "Layouts",
  headingPath: "Routing\u001fLayouts",
  anchor: "layouts",
  contentType: "cheat-sheet",
  collection: "nextjs",
  tags: ["react", "nextjs"],
  tagsText: "react nextjs",
  official: true,
  primary: false,
  publisher: "",
  canonicalUrl: "",
};

it("searches the fields in order of weight", () => {
  expect(SEARCH_PROPERTIES).toEqual([
    "title",
    "heading",
    "tagsText",
    "summary",
    "publisher",
    "body",
  ]);
});

it("reads a namespaced or snake-cased term as separate words", () => {
  expect(searchableTechnicalTerm("  App\\Models::find_or_fail ")).toBe(
    "App Models find or fail",
  );
});

it("retries with typo tolerance only when a long enough exact term finds nothing", () => {
  expect(retriesWithTolerance(0, "nextj")).toBe(true);
  expect(retriesWithTolerance(0, "next")).toBe(false);
  expect(retriesWithTolerance(3, "nextjs")).toBe(false);
});

it("admits only primary sections when browsing, and every filter when asked", () => {
  expect(buildWhere(query())).toEqual({ primary: true });
  expect(buildWhere(query({ query: "hooks" }))).toBeUndefined();
  expect(buildWhere(query({ query: "hooks", officialOnly: true }))).toEqual({
    official: true,
  });
  expect(
    buildWhere(
      query({
        contentTypes: ["cheat-sheet"],
        collections: ["react"],
        tags: ["hooks"],
        officialOnly: true,
      }),
    ),
  ).toEqual({
    and: [
      { primary: true },
      { contentType: { in: ["cheat-sheet"] } },
      { collection: { in: ["react"] } },
      { tags: { containsAll: ["hooks"] } },
      { official: true },
    ],
  });
});

it("ranks a title and a tag that are the query above the engine's score", () => {
  expect(toHit(section, 1.5, " NextJS ").score).toBe(151.5);
  expect(toHit(section, 1.5, "react").score).toBe(51.5);
  expect(toHit(section, 1.5, "router").score).toBe(1.5);
  expect(toHit(section, 1.5, "").score).toBe(1.5);
});

it("shapes a hit with its heading path, an excerpt around the match and no empty source", () => {
  const hit = toHit(section, 2, "app router");
  expect(hit.headingPath).toEqual(["Routing", "Layouts"]);
  expect(hit.excerpt.startsWith("…")).toBe(true);
  expect(hit.excerpt.endsWith("…")).toBe(true);
  expect(hit.excerpt).toContain("the app router handles layouts");
  expect(hit.excerpt).toHaveLength(222);
  expect(hit).not.toHaveProperty("publisher");
  expect(hit).not.toHaveProperty("canonicalUrl");
  expect(toHit(section, 2, "").excerpt).toBe(section.body.slice(0, 220));
  expect(
    toHit({ ...section, publisher: "Vercel", canonicalUrl: "https://x" }, 2, "")
      .publisher,
  ).toBe("Vercel");
});
