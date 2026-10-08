// The coach note contract: what a coach may post to the live window, and the
// bounds that keep a note short enough to read while speaking.
import { describe, expect, it } from "vitest";
import {
  coachNoteInputSchema,
  coachNoteLinkSchema,
  coachNoteSchema,
  coachNotesResponseSchema,
} from "./coach-notes";

const accepts = (input: unknown) =>
  coachNoteInputSchema.safeParse(input).success;
const stored = {
  id: "00000000-0000-4000-8000-000000000001",
  createdAt: "2026-10-08T17:40:00.000Z",
  title: "Consistency",
  tone: "say",
  points: [],
  links: [],
};

describe("a coach note's links", () => {
  it("accepts an https address", () => {
    expect(
      coachNoteLinkSchema.parse({
        label: "  Outbox pattern ",
        url: "https://example.com/outbox",
      }),
    ).toEqual({ label: "Outbox pattern", url: "https://example.com/outbox" });
  });

  it.each([
    ["plain http", "http://example.com/outbox"],
    ["a script address", "javascript:alert(1)"],
    ["a file address", "file:///etc/hosts"],
    ["a data address", "data:text/html,hello"],
    ["a relative path", "/docs/outbox"],
    ["no address at all", "outbox"],
  ])("refuses %s", (_name, url) => {
    expect(coachNoteLinkSchema.safeParse({ label: "Docs", url }).success).toBe(
      false,
    );
  });

  it("bounds the label (1 to 80 characters) and the address (600)", () => {
    const link = (label: string, url = "https://example.com/") =>
      coachNoteLinkSchema.safeParse({ label, url }).success;
    expect(link("   ")).toBe(false);
    expect(link("a".repeat(80))).toBe(true);
    expect(link("a".repeat(81))).toBe(false);
    const address = (length: number) =>
      `https://example.com/${"a".repeat(length - "https://example.com/".length)}`;
    expect(link("Docs", address(600))).toBe(true);
    expect(link("Docs", address(601))).toBe(false);
  });

  it("refuses a key it does not know", () => {
    expect(
      coachNoteLinkSchema.safeParse({
        label: "Docs",
        url: "https://example.com/",
        target: "_blank",
      }).success,
    ).toBe(false);
  });
});

describe("a coach note as posted", () => {
  it("needs only a title: it is a note to say, with no points and no links", () => {
    expect(
      coachNoteInputSchema.parse({ title: " Monolith or service " }),
    ).toEqual({
      title: "Monolith or service",
      tone: "say",
      points: [],
      links: [],
    });
  });

  it("is a note to say or one to watch, nothing else", () => {
    expect(accepts({ title: "Pace", tone: "watch" })).toBe(true);
    expect(accepts({ title: "Pace", tone: "shout" })).toBe(false);
  });

  it("bounds the title to 1 to 120 characters", () => {
    expect(accepts({})).toBe(false);
    expect(accepts({ title: "  " })).toBe(false);
    expect(accepts({ title: "a".repeat(120) })).toBe(true);
    expect(accepts({ title: "a".repeat(121) })).toBe(false);
  });

  it("takes up to six points of up to 280 characters, none of them blank", () => {
    const points = (list: string[]) => accepts({ title: "T", points: list });
    expect(points(Array(6).fill("Name the criteria"))).toBe(true);
    expect(points(Array(7).fill("Name the criteria"))).toBe(false);
    expect(points(["a".repeat(280)])).toBe(true);
    expect(points(["a".repeat(281)])).toBe(false);
    expect(points(["  "])).toBe(false);
  });

  it("takes Markdown of up to 6,000 characters, never an empty one", () => {
    const markdown = (text: string) => accepts({ title: "T", markdown: text });
    expect(markdown("## Say\n- **outbox**")).toBe(true);
    expect(markdown("a".repeat(6_000))).toBe(true);
    expect(markdown("a".repeat(6_001))).toBe(false);
    expect(markdown("   ")).toBe(false);
  });

  it("takes up to five links, each of them https", () => {
    const link = (at: number) => ({
      label: `Docs ${at}`,
      url: `https://example.com/${at}`,
    });
    const links = (count: number) =>
      accepts({
        title: "T",
        links: Array.from({ length: count }, (_, at) => link(at)),
      });
    expect(links(5)).toBe(true);
    expect(links(6)).toBe(false);
    expect(
      accepts({
        title: "T",
        links: [link(1), { label: "Plain", url: "http://example.com/" }],
      }),
    ).toBe(false);
  });

  it("refuses a key it does not know, so a coach cannot set the id or the time", () => {
    expect(accepts({ title: "T", id: stored.id })).toBe(false);
    expect(accepts({ title: "T", html: "<b>bold</b>" })).toBe(false);
  });
});

describe("a coach note as kept", () => {
  it("carries a uuid and an ISO time", () => {
    expect(coachNoteSchema.safeParse(stored).success).toBe(true);
    expect(coachNoteSchema.safeParse({ ...stored, id: "note-1" }).success).toBe(
      false,
    );
    expect(
      coachNoteSchema.safeParse({ ...stored, createdAt: "yesterday" }).success,
    ).toBe(false);
  });

  it("is listed with a revision that is a whole number from 0", () => {
    const response = (revision: number) =>
      coachNotesResponseSchema.safeParse({ revision, notes: [stored] }).success;
    expect(response(0)).toBe(true);
    expect(response(7)).toBe(true);
    expect(response(-1)).toBe(false);
    expect(response(1.5)).toBe(false);
    expect(
      coachNotesResponseSchema.safeParse({
        revision: 1,
        notes: [],
        extra: true,
      }).success,
    ).toBe(false);
  });
});
