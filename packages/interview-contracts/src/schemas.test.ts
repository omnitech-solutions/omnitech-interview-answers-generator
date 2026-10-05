import { describe, expect, it } from "vitest";

import {
  libraryItemInputSchema,
  libraryItemSchema,
  librarySearchQuerySchema,
  librarySourceSchema,
} from "./schemas";

const guide = {
  slug: "react-state",
  title: "React state",
  summary: "One source of truth.",
  body: "# State\n\nDerive rather than duplicate.",
  contentType: "concept-guide" as const,
  collection: "react",
  tags: ["react", "state-management"],
};

describe("Library contracts", () => {
  it("accepts every content type and applies bounded search defaults", () => {
    for (const contentType of [
      "cheat-sheet",
      "concept-guide",
      "dsa-pattern",
    ] as const) {
      expect(
        libraryItemInputSchema.parse({ ...guide, contentType }).contentType,
      ).toBe(contentType);
    }
    expect(librarySearchQuerySchema.parse({})).toEqual({
      query: "",
      contentTypes: [],
      collections: [],
      tags: [],
      officialOnly: false,
      offset: 0,
      limit: 20,
    });
    expect(librarySearchQuerySchema.safeParse({ limit: 51 }).success).toBe(
      false,
    );
  });

  it("requires trustworthy metadata for official references", () => {
    expect(
      libraryItemInputSchema.safeParse({
        ...guide,
        contentType: "official-reference",
      }).success,
    ).toBe(false);
    expect(
      libraryItemInputSchema.parse({
        ...guide,
        contentType: "official-reference",
        source: {
          publisher: "React",
          canonicalUrl: "https://react.dev/learn/state-as-a-snapshot",
          official: true,
          version: "19",
          lastVerifiedAt: "2026-07-27",
        },
      }).source,
    ).toMatchObject({ publisher: "React", official: true });
    expect(
      librarySourceSchema.safeParse({
        publisher: "React",
        canonicalUrl: "http://react.dev",
        official: true,
        lastVerifiedAt: "2026-07-27",
      }).success,
    ).toBe(false);
    expect(
      librarySourceSchema.safeParse({
        publisher: "Studio",
        canonicalUrl: "https://example.com",
        official: false,
        lastVerifiedAt: "2026-07-27",
      }).success,
    ).toBe(false);
  });

  it("rejects unofficial source badges, invalid slugs, tags, and records", () => {
    expect(
      libraryItemInputSchema.safeParse({
        ...guide,
        source: {
          publisher: "Studio",
          canonicalUrl: "https://example.com",
          official: true,
          lastVerifiedAt: "2026-07-27",
        },
      }).success,
    ).toBe(false);
    expect(
      libraryItemInputSchema.safeParse({
        ...guide,
        slug: "React State",
        tags: ["React Hooks"],
      }).success,
    ).toBe(false);
    expect(
      libraryItemSchema.safeParse({
        ...guide,
        id: "not-a-uuid",
        status: "published",
        createdAt: "today",
        updatedAt: "today",
        revision: 0,
      }).success,
    ).toBe(false);
  });
});
